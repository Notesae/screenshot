"""Synthetic release state transitions; no GitHub connection, secret or repository mutation."""
import contextlib,hashlib,importlib.util,io,json,os,tempfile,unittest,urllib.error,urllib.request,zipfile
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('release_script',Path(__file__).with_name('release-prerelease.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
COMMIT='a'*40
class Response(io.BytesIO):
    def __enter__(self):return self
    def __exit__(self,*args):self.close()
class Server:
    def __init__(self,archive,mode='normal'):
        self.archive=archive;self.mode=mode;self.writes=[];self.release=None;self.assets={}
        # MSI 夹具只作为静态字节参与发布模拟，绝不执行安装。
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as z:
            z.writestr('Screenshot-0.4.6-setup-x64.msi',b'synthetic-msi')
            z.writestr('installer-verification.json',json.dumps({'version':'0.4.6','sha256':hashlib.sha256(b'synthetic-msi').hexdigest(),'filesCompared':1,'scope':'perUser','chineseTermsVerified':True,'sourceManifestSha256':('0' if mode=='installer-mismatched' else 'c')*64}))
        self.installer_archive=buffer.getvalue()
    def open(self,req,timeout=None):
        url=req.full_url;method=req.get_method();data=None
        if method in ('POST','PATCH'):self.writes.append((method,url))
        if '/actions/workflows/' in url:
            data={'workflow_runs':[] if self.mode=='ci-missing' else [{'id':12,'head_sha':COMMIT,'head_branch':'main','event':'push','status':'completed','conclusion':'success','html_url':'https://github.com/Notesae/screenshot/actions/runs/12'}]}
        elif '/actions/runs/12/jobs' in url:data={'jobs':[{'conclusion':'success'}]}
        elif '/actions/runs/12/artifacts' in url:
            digest=hashlib.sha256(self.archive).hexdigest() if self.mode!='artifact-corrupt' else '0'*64
            data={'artifacts':[{'id':22,'name':'Screenshot-win-x64','expired':False,'digest':'sha256:'+digest,'size_in_bytes':len(self.archive),'archive_download_url':'https://api.github.com/repos/Notesae/screenshot/actions/artifacts/22/zip'}]}
            if self.mode!='installer-missing':data['artifacts'].append({'id':23,'name':'Screenshot-installer-win-x64','expired':False,'digest':'sha256:'+hashlib.sha256(self.installer_archive).hexdigest(),'size_in_bytes':len(self.installer_archive),'archive_download_url':'https://api.github.com/repos/Notesae/screenshot/actions/artifacts/23/zip'})
        elif '/actions/artifacts/22/zip' in url:return Response(self.archive)
        elif '/actions/artifacts/23/zip' in url:return Response(self.installer_archive+(b'bad' if self.mode=='installer-corrupt' else b''))
        elif '/releases/tags/' in url:
            if self.mode=='existing':data={'draft':False,'target_commitish':COMMIT,'body':'already published'}
            else:raise urllib.error.HTTPError(url,404,'missing',None,None)
        elif url.endswith('/releases') and method=='POST':
            self.release={**json.loads(req.data),'id':33,'assets':[],'upload_url':'https://uploads.github.com/repos/Notesae/screenshot/releases/33/assets{?name,label}','html_url':'https://github.com/Notesae/screenshot/releases/tag/v0.4.6'};data=self.release
        elif 'uploads.github.com' in url:
            name=urllib.parse.parse_qs(urllib.parse.urlparse(url).query)['name'][0];number=100+len(self.assets)
            a={'id':number,'name':name,'size':len(req.data),'digest':'sha256:'+hashlib.sha256(req.data).hexdigest(),'url':f'https://api.github.com/repos/Notesae/screenshot/releases/assets/{number}','browser_download_url':'https://github.com/Notesae/screenshot/releases/download/v0.4.6/'+name}
            self.assets[a['url']]=req.data;self.release['assets'].append(a);data=a
        elif '/releases/assets/' in url:
            value=self.assets[url]
            if self.mode=='download-corrupt':value+=b'bad'
            return Response(value)
        elif url.endswith('/releases/33'):
            if method=='PATCH':self.release.update(json.loads(req.data))
            data=self.release
        else:raise AssertionError((method,url))
        return Response(json.dumps(data).encode())
class ReleaseTests(unittest.TestCase):
    def scenario(self,mode):
        with tempfile.TemporaryDirectory(prefix='screenshot-release-test-') as d:
            root=Path(d);(root/'editor').mkdir();(root/'docs').mkdir()
            (root/'editor/package.json').write_text('{"version":"0.4.6"}')
            (root/'docs/RELEASE-NOTES-0.4.6.md').write_text('中文 @COMMIT@ @CI_URL@ @ZIP_SHA256@',encoding='utf-8')
            buffer=io.BytesIO()
            with zipfile.ZipFile(buffer,'w') as z:z.writestr('synthetic.txt','synthetic only')
            server=Server(buffer.getvalue(),mode)
            env={'GITHUB_REPOSITORY':'Notesae/screenshot','GITHUB_SHA':COMMIT,'GITHUB_REF_NAME':'v0.4.6','GITHUB_REF_TYPE':'tag','GH_TOKEN':'synthetic-not-a-secret'}
            caught=None
            with patch.object(m,'ROOT',root),patch.dict(os.environ,env,clear=True),patch.object(m.urllib.request,'build_opener',return_value=server),patch.object(m.subprocess,'check_output',return_value=COMMIT),patch.object(m,'package_check',return_value={'files':1,'manifestSha256':'c'*64,'legal':{'digest':'b'*64}}),contextlib.redirect_stdout(io.StringIO()):
                try:m.main()
                except RuntimeError as e:caught=str(e)
            out=root/'artifacts/release-verification'
            result=json.loads((out/'published-verification.json').read_text('utf-8')) if (out/'published-verification.json').exists() else None
            state=json.loads((out/'publication-state.json').read_text('utf-8')) if (out/'publication-state.json').exists() else None
            return server,caught,result,state
    def test_success_downloads_zip_and_msi_with_all_seven_assets(self):
        s,e,r,state=self.scenario('normal');self.assertIsNone(e);self.assertTrue(r['allPublishedAssetsDownloadedAndVerified']);self.assertEqual(len(r['assets']),7);self.assertFalse(s.release['draft']);self.assertTrue(s.release['prerelease'])
    def test_missing_installer_never_publishes_zip_alone(self):
        s,e,r,state=self.scenario('installer-missing');self.assertIn('installer CI artifact',e);self.assertEqual(s.writes,[])
    def test_corrupt_installer_never_writes(self):
        s,e,r,state=self.scenario('installer-corrupt');self.assertIn('Installer CI bytes differ',e);self.assertEqual(s.writes,[])
    def test_installer_for_different_package_never_writes(self):
        s,e,r,state=self.scenario('installer-mismatched');self.assertIn('does not match',e);self.assertEqual(s.writes,[])
    def test_no_successful_ci_never_writes(self):
        s,e,r,state=self.scenario('ci-missing');self.assertIn('no successful',e);self.assertEqual(s.writes,[])
    def test_bad_artifact_digest_never_writes(self):
        s,e,r,state=self.scenario('artifact-corrupt');self.assertIn('differ',e);self.assertEqual(s.writes,[])
    def test_existing_version_is_preserved(self):
        s,e,r,state=self.scenario('existing');self.assertIn('already exists',e);self.assertEqual(s.writes,[])
    def test_failed_download_is_not_reported_verified(self):
        s,e,r,state=self.scenario('download-corrupt');self.assertIn('download mismatch',e);self.assertIsNone(r);self.assertTrue(state['published']);self.assertFalse(state['downloadVerified'])
    def test_redirect_does_not_forward_token_to_asset_host(self):
        req=urllib.request.Request('https://api.github.com/repos/Notesae/screenshot/actions/artifacts/1/zip',headers={'Authorization':'Bearer synthetic'})
        redirected=m.SafeRedirect().redirect_request(req,None,302,'Found',{},'https://release-assets.githubusercontent.com/file?signature=synthetic')
        self.assertIsNone(redirected.get_header('Authorization'))
    def test_nested_checksum_files_are_covered(self):
        with tempfile.TemporaryDirectory() as d:
            package=Path(d);(package/'legal').mkdir();(package/'nested').mkdir()
            legal={'digest':'synthetic'}
            (package/'legal/package-legal.json').write_text(json.dumps(legal))
            (package/'nested/SHA256SUMS.txt').write_text('nested provenance checksum')
            (package/'Screenshot.exe').write_bytes(b'synthetic')
            (package/'sbom.cdx.json').write_text(json.dumps({'metadata':{'component':{'version':'0.4.6'}},'components':[]}))
            entries=[p for p in package.rglob('*') if p.is_file()]
            (package/'SHA256SUMS.txt').write_text(''.join(m.sha(p)+'  '+p.relative_to(package).as_posix()+'\n' for p in entries))
            outputs=[json.dumps(legal),json.dumps({'ProductVersion':'0.4.6+'+COMMIT,'LegalCopyright':'Notesae'})]
            with patch.object(m.subprocess,'check_output',side_effect=outputs):
                self.assertEqual(m.package_check(package,'0.4.6',COMMIT)['rootHashes'],4)
            (package/'unexpected.txt').write_text('extra')
            with self.assertRaises(RuntimeError):m.package_check(package,'0.4.6',COMMIT)
    def test_zip_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            archive=Path(d)/'bad.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('../outside','bad')
            with self.assertRaises(RuntimeError):m.unpack(archive,Path(d)/'unpacked')
if __name__=='__main__':unittest.main()
