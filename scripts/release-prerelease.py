"""Publish an existing verified CI ZIP without rebuilding/repacking or reading local credentials.

Only a tag workflow may execute writes, using its explicitly scoped built-in GH_TOKEN.
"""
from pathlib import Path, PurePosixPath
import datetime,hashlib,json,os,re,subprocess,urllib.request,urllib.error,urllib.parse,zipfile

ROOT=Path(__file__).resolve().parents[1]
def sha(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        result=super().redirect_request(req,fp,code,msg,headers,newurl)
        if result and urllib.parse.urlparse(req.full_url).netloc!=urllib.parse.urlparse(newurl).netloc:result.remove_header('Authorization')
        return result
def unpack(archive,destination):
    with zipfile.ZipFile(archive) as z:
        if z.testzip() is not None:raise RuntimeError('CI ZIP CRC failed')
        if len(z.infolist())>6000 or sum(i.file_size for i in z.infolist())>2_000_000_000:raise RuntimeError('Unexpected archive limits')
        for entry in z.infolist():
            p=PurePosixPath(entry.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in entry.filename or ':' in entry.filename or (entry.external_attr>>16)&0o170000==0o120000:raise RuntimeError('Unsafe archive path')
        z.extractall(destination)
def package_check(package,version,commit):
    rows=(package/'SHA256SUMS.txt').read_text('utf-8').splitlines();seen=set()
    for row in rows:
        expected,name=row.split('  ',1)
        if name in seen or not re.fullmatch('[0-9a-f]{64}',expected):raise RuntimeError('Invalid package checksums')
        target=package/name
        if '..' in PurePosixPath(name).parts or not target.resolve().is_relative_to(package.resolve()) or sha(target)!=expected:raise RuntimeError('Package hash failed: '+name)
        seen.add(name)
    actual={p.relative_to(package).as_posix() for p in package.rglob('*') if p.is_file() and p!=package/'SHA256SUMS.txt'}
    if seen!=actual:raise RuntimeError('Package checksum coverage differs')
    bom=json.loads((package/'sbom.cdx.json').read_text('utf-8'))
    if bom['metadata']['component']['version']!=version:raise RuntimeError('SBOM version mismatch')
    legal=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./scripts/terms-audit.cjs').audit(process.argv[1])))",str(package)],cwd=ROOT,text=True))
    if legal!=json.loads((package/'legal/package-legal.json').read_text('utf-8')):raise RuntimeError('Packaged legal digest mismatch')
    env=dict(os.environ,SCREENSHOT_RELEASE_EXE=str(package/'Screenshot.exe'))
    info=json.loads(subprocess.check_output(['pwsh','-NoProfile','-Command','(Get-Item -LiteralPath $env:SCREENSHOT_RELEASE_EXE).VersionInfo | Select-Object ProductVersion,LegalCopyright | ConvertTo-Json'],env=env,text=True,encoding='utf-8-sig'))
    if info['ProductVersion']!=version+'+'+commit or 'Notesae' not in info['LegalCopyright']:raise RuntimeError('Executable version/copyright mismatch')
    return {'files':len(actual)+1,'rootHashes':len(seen),'sbomComponents':len(bom['components']),'legal':legal,'executable':info}
def main():
    repo=os.environ.get('GITHUB_REPOSITORY');commit=os.environ.get('GITHUB_SHA','');tag=os.environ.get('GITHUB_REF_NAME','')
    if repo!='Notesae/screenshot' or os.environ.get('GITHUB_REF_TYPE')!='tag' or not re.fullmatch('[0-9a-f]{40}',commit):raise RuntimeError('Only this repository tag workflow may publish')
    version=json.loads((ROOT/'editor/package.json').read_text('utf-8'))['version']
    if tag!='v'+version or subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()!=commit:raise RuntimeError('Tag/source version mismatch')
    token=os.environ.get('GH_TOKEN')
    if not token:raise RuntimeError('Missing scoped workflow token')
    opener=urllib.request.build_opener(SafeRedirect())
    def request(url,method='GET',data=None,content='application/vnd.github+json',missing=False):
        if not url.startswith(('https://api.github.com/repos/Notesae/screenshot/','https://uploads.github.com/repos/Notesae/screenshot/')):raise RuntimeError('Unexpected GitHub endpoint')
        headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Screenshot-verified-release','Content-Type':content}
        if isinstance(data,dict):data=json.dumps(data,ensure_ascii=False).encode('utf-8')
        try:
            with opener.open(urllib.request.Request(url,data=data,method=method,headers=headers),timeout=90) as response:return response.read()
        except urllib.error.HTTPError as error:
            if missing and error.code==404:return None
            raise RuntimeError('GitHub request failed with HTTP '+str(error.code)) from None
    api='https://api.github.com/repos/'+repo+'/'
    def get(endpoint,**kwargs):
        raw=request(api+endpoint,**kwargs);return None if raw is None else json.loads(raw)
    run_data=get('actions/workflows/verify.yml/runs?head_sha='+commit+'&status=success&per_page=100')
    runs=[r for r in run_data['workflow_runs'] if r['head_sha']==commit and r['head_branch']=='main' and r['event']=='push' and r['status']=='completed' and r['conclusion']=='success']
    if not runs:raise RuntimeError('Exact commit has no successful completed main verification')
    run=max(runs,key=lambda r:r['id'])
    jobs=get(f"actions/runs/{run['id']}/jobs?per_page=100")['jobs']
    if not jobs or any(j['conclusion']!='success' for j in jobs):raise RuntimeError('Verification jobs are not all successful')
    items=[a for a in get(f"actions/runs/{run['id']}/artifacts?per_page=100")['artifacts'] if a['name']=='Screenshot-win-x64' and not a['expired']]
    if len(items)!=1:raise RuntimeError('Expected one active portable CI artifact')
    artifact=items[0];expected=artifact.get('digest','')
    if not re.fullmatch('sha256:[0-9a-f]{64}',expected):raise RuntimeError('Artifact digest unavailable')
    out=ROOT/'artifacts/release-verification';out.mkdir(parents=True,exist_ok=False)
    zip_name='Screenshot-'+version+'-win-x64.zip';archive=out/zip_name
    archive.write_bytes(request(artifact['archive_download_url']))
    if sha(archive)!=expected[7:] or archive.stat().st_size!=artifact['size_in_bytes']:raise RuntimeError('Downloaded CI bytes differ from official digest')
    package=out/'portable';unpack(archive,package);checks=package_check(package,version,commit)
    body=(ROOT/f'docs/RELEASE-NOTES-{version}.md').read_text('utf-8')
    values={'@VERSION@':version,'@COMMIT@':commit,'@CI_URL@':run['html_url'],'@ZIP_SHA256@':sha(archive),'@ZIP_BYTES@':str(archive.stat().st_size),'@TERMS_DIGEST@':checks['legal']['digest']}
    for key,value in values.items():body=body.replace(key,value)
    if re.search('@[A-Z_]+@',body):raise RuntimeError('Unfilled release note value')
    marker=f"<!-- screenshot-release:{commit}:{artifact['id']} -->";body+='\n'+marker+'\n'
    notes=out/'RELEASE-NOTES.zh-CN.md';notes.write_text(body,encoding='utf-8',newline='\n')
    checksum=out/(zip_name+'.sha256');checksum.write_text(sha(archive)+'  '+zip_name+'\n',encoding='utf-8',newline='\n')
    manifest={'version':version,'commit':commit,'ciRun':run['id'],'ciUrl':run['html_url'],'ciArtifact':artifact['id'],'ciDigest':expected,'zip':zip_name,'bytes':archive.stat().st_size,'sha256':sha(archive),'byteIdenticalToCi':True,'repacked':False,'checks':checks,'realDesktopTested':False,'legalReviewComplete':False}
    provenance=out/'release-manifest.json';provenance.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    assets=[archive,checksum,notes,provenance]
    sums=out/'SHA256SUMS.txt';sums.write_text(''.join(sha(p)+'  '+p.name+'\n' for p in assets),encoding='utf-8',newline='\n');assets.append(sums)
    existing=get('releases/tags/'+tag,missing=True)
    if existing and (not existing['draft'] or existing['target_commitish']!=commit or marker not in existing['body']):raise RuntimeError('Version already exists; preserved without modification')
    release=existing or get('releases',method='POST',data={'tag_name':tag,'target_commitish':commit,'name':'Screenshot '+tag+' 预发布版','body':body,'draft':True,'prerelease':True,'make_latest':'false'})
    def checkpoint(stage):
        (out/'publication-state.json').write_text(json.dumps({'stage':stage,'releaseId':release['id'],'releaseUrl':release['html_url'],'commit':commit,'ciArtifactId':artifact['id'],'published':not release['draft'],'downloadVerified':stage=='verified'},indent=2)+'\n',encoding='utf-8')
    checkpoint('draft_ready')
    for asset in assets:
        current=next((a for a in release['assets'] if a['name']==asset.name),None)
        if current:
            if current.get('digest')!='sha256:'+sha(asset):raise RuntimeError('Existing draft asset differs; preserved')
        else:
            upload=release['upload_url'].split('{')[0]+'?name='+urllib.parse.quote(asset.name)
            uploaded=json.loads(request(upload,method='POST',data=asset.read_bytes(),content='application/zip' if asset.suffix=='.zip' else 'application/octet-stream'))
            if uploaded.get('digest')!='sha256:'+sha(asset):raise RuntimeError('Uploaded asset digest mismatch')
    release=get('releases/'+str(release['id']),method='PATCH',data={'draft':False,'prerelease':True,'make_latest':'false'})
    checkpoint('published_pending_download_verification')
    download=out/'downloaded';download.mkdir()
    verified=[]
    published=get('releases/'+str(release['id']))
    if published['draft'] or not published['prerelease'] or published['tag_name']!=tag:raise RuntimeError('Published release state mismatch')
    if {a['name'] for a in published['assets']}!={a.name for a in assets}:raise RuntimeError('Published asset set differs')
    for asset in assets:
        remote=next(a for a in published['assets'] if a['name']==asset.name)
        # Use the authenticated asset endpoint; redirect strips Authorization before signed asset host.
        headers={'Authorization':'Bearer '+token,'Accept':'application/octet-stream','X-GitHub-Api-Version':'2022-11-28','User-Agent':'Screenshot-verified-release'}
        with opener.open(urllib.request.Request(remote['url'],headers=headers),timeout=90) as response:data=response.read()
        copy=download/asset.name;copy.write_bytes(data)
        if sha(copy)!=sha(asset) or len(data)!=remote['size'] or remote.get('digest')!='sha256:'+sha(asset):raise RuntimeError('Published download mismatch: '+asset.name)
        verified.append({'file':asset.name,'bytes':len(data),'sha256':sha(copy),'url':remote['browser_download_url']})
    result={'releaseUrl':published['html_url'],'releaseId':published['id'],'published':True,'prerelease':True,'commit':commit,'ciRun':run['id'],'ciArtifactId':artifact['id'],'allPublishedAssetsDownloadedAndVerified':True,'assets':verified,'checks':checks,'verifiedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (out/'published-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    checkpoint('verified')
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
