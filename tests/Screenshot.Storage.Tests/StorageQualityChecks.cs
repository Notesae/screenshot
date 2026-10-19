using System.Buffers.Binary;
using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Screenshot.Storage;

// 仅操作独立临时目录和本程序启动的子进程；不终止用户应用、不制造系统崩溃或断电。
internal static class StorageQualityChecks
{
    private const string Prefix="data:image/png;base64,";
    private static readonly JsonSerializerOptions Json=new(){WriteIndented=true,PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
    private static void Check(bool value,string message){if(!value)throw new Exception(message);}
    public static async Task<int> Run(string[] args)
    {
        try{
            if(args[0]=="--quality-worker"){await Worker(args[1],args[2],args[3]);return 0;}
            var root=Path.Combine(Path.GetTempPath(),"Screenshot-quality-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
            var png=NoisePng(3200,1800,17);Check(png.Length<20*1024*1024,"Synthetic PNG exceeds product limit");
            var benchmark=await Benchmark(Path.Combine(root,"benchmark"),png);
            if(args.Length>1)await File.WriteAllTextAsync(args[1]+".benchmark.json",JsonSerializer.Serialize(benchmark,Json));
            if(args[0]=="--quality-benchmark"){var benchmarkReport=JsonSerializer.Serialize(benchmark,Json);if(args.Length>1)await File.WriteAllTextAsync(args[1],benchmarkReport);Console.WriteLine(benchmarkReport);return 0;}
            var crashes=new List<object>();
            foreach(var stage in new[]{"partial-asset","asset-before-commit","dirty-wal","committed"}){Console.WriteLine("CRASH_STAGE "+stage);crashes.Add(await Crash(Path.Combine(root,stage),stage,png));}
            var result=new{schemaVersion=1,syntheticOnly=true,root,benchmark,crashes,actualPowerLoss=false,desktopAccess=false};
            var report=JsonSerializer.Serialize(result,Json);if(args.Length>1){Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[1]))!);await File.WriteAllTextAsync(args[1],report);}
            Console.WriteLine(report);return 0;
        }catch(Exception e){Console.Error.WriteLine("FAIL isolated storage quality: "+e.GetType().Name+" "+e.Message+(e is SqliteException sql?" extended="+sql.SqliteExtendedErrorCode:"")+" "+e.StackTrace);return 1;}
    }
    private static JsonElement Document(byte[] png,string text)=>JsonSerializer.SerializeToElement(new{schemaVersion=2,image=new{dataUrl=Prefix+Convert.ToBase64String(png),name="synthetic-noise.png",width=3200,height=1800},editor=new{text,annotations=Array.Empty<object>(),translationData=new{schemaVersion=1,source=text,providerId="synthetic",providerRevision=new string('a',64),targetLanguage="Chinese",chunks=new[]{new{id="a-tr-0",sourceBlockId="a",source=text,text="corrected",generatedText="generated",status="done"}}}}});
    private static async Task<object> Benchmark(string root,byte[] png)
    {
        using var store=new SnapshotStore(root);var document=Document(png,"benchmark");await store.SaveAsync("benchmark",1,document);await store.LoadAsync("benchmark");
        GC.Collect();GC.WaitForPendingFinalizers();GC.Collect();
        using var process=Process.GetCurrentProcess();process.Refresh();long baselineWorking=process.WorkingSet64,baselinePrivate=process.PrivateMemorySize64,peakWorking=baselineWorking,peakPrivate=baselinePrivate;
        using var sampling=new CancellationTokenSource();var sampler=Task.Run(async()=>{while(!sampling.IsCancellationRequested){process.Refresh();peakWorking=Math.Max(peakWorking,process.WorkingSet64);peakPrivate=Math.Max(peakPrivate,process.PrivateMemorySize64);try{await Task.Delay(10,sampling.Token);}catch(OperationCanceledException){break;}}});
        var allocated=GC.GetTotalAllocatedBytes(true);var save=new List<double>();var load=new List<double>();var saveAllocation=new List<long>();var loadAllocation=new List<long>();var expectedUrl=document.GetProperty("image").GetProperty("dataUrl").GetString();
        for(var i=0;i<3;i++){var allocatedBefore=GC.GetTotalAllocatedBytes(true);var watch=Stopwatch.StartNew();await store.SaveAsync("benchmark",i+2,document);save.Add(watch.Elapsed.TotalMilliseconds);saveAllocation.Add(GC.GetTotalAllocatedBytes(true)-allocatedBefore);allocatedBefore=GC.GetTotalAllocatedBytes(true);watch.Restart();var restored=await store.LoadAsync("benchmark");load.Add(watch.Elapsed.TotalMilliseconds);loadAllocation.Add(GC.GetTotalAllocatedBytes(true)-allocatedBefore);Check(restored.Revision==i+2&&restored.Document.GetProperty("image").GetProperty("dataUrl").GetString()==expectedUrl,"Large storage roundtrip differs");}
        var allocationBytes=GC.GetTotalAllocatedBytes(true)-allocated;sampling.Cancel();await sampler;
        var usage=await store.GetUsageAsync();Check(usage.Documents==1&&usage.ReferencedAssetBytes==png.Length,"Deduplicated storage usage differs");
        GC.Collect();GC.WaitForPendingFinalizers();GC.Collect();process.Refresh();
        return new{width=3200,height=1800,pngBytes=png.Length,samples=3,saveMs=save,loadMs=load,saveAllocationBytes=saveAllocation,loadAllocationBytes=loadAllocation,managedAllocationBytes=allocationBytes,baselineWorkingBytes=baselineWorking,baselinePrivateBytes=baselinePrivate,sampledPeakWorkingBytes=peakWorking,sampledPeakPrivateBytes=peakPrivate,afterGcWorkingBytes=process.WorkingSet64,afterGcPrivateBytes=process.PrivateMemorySize64,memorySamplingIntervalMs=10,scope="One storage process, prepared JsonElement held; PNG generation and warmup excluded. GC does not imply OS working-set reclamation."};
    }
    // 同一生产SaveAsync路径通过测试数据库的慢触发器停在提交前；无需生产故障注入接口。
    private static async Task<object> Crash(string root,string stage,byte[] large)
    {
        Directory.CreateDirectory(root);var token=Guid.NewGuid().ToString("N");File.WriteAllText(Path.Combine(root,".quality-owner"),token);
        var baseline=Document(NoisePng(3200,1800,3),"committed baseline");using(var store=new SnapshotStore(root))await store.SaveAsync("document",1,baseline);
        File.WriteAllText(Path.Combine(root,"assets","unrelated.txt"),"owned synthetic sentinel; collector must retain");
        using(var connection=Connect(root)){using var command=connection.CreateCommand();command.CommandText=stage=="asset-before-commit"?"CREATE TRIGGER quality_pause BEFORE UPDATE ON snapshots WHEN NEW.revision=2 BEGIN SELECT (WITH RECURSIVE waiting(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM waiting WHERE n<1000000000) SELECT sum(n) FROM waiting); END;":"CREATE TABLE quality_scratch (payload BLOB);";command.ExecuteNonQuery();}
        var info=new ProcessStartInfo(Environment.ProcessPath!){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        if(Path.GetFileNameWithoutExtension(Environment.ProcessPath!).Equals("dotnet",StringComparison.OrdinalIgnoreCase))info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);foreach(var argument in new[]{"--quality-worker",root,stage,token})info.ArgumentList.Add(argument);
        using var child=Process.Start(info)??throw new Exception("Worker failed to start");var error=child.StandardError.ReadToEndAsync();var watch=Stopwatch.StartNew();long observedBytes=0;
        try{
            if(stage is "dirty-wal" or "committed"){
                var line=await child.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20));Check(line==(stage=="dirty-wal"?"DIRTY":"COMMITTED"),"Worker did not reach requested crash stage: "+line);
                if(stage=="dirty-wal")Check(new FileInfo(Path.Combine(root,"snapshots.db-wal")).Length>32768,"No spilled WAL observed");
            }else{
                var seen=false;while(watch.Elapsed<TimeSpan.FromSeconds(20)&&!child.HasExited){
                    if(stage=="partial-asset")foreach(var path in Directory.EnumerateFiles(Path.Combine(root,"assets"),".asset-*.tmp")){try{var length=new FileInfo(path).Length;if(length>0&&length<large.Length){observedBytes=length;seen=true;break;}}catch(FileNotFoundException){}}
                    else seen=Directory.EnumerateFiles(Path.Combine(root,"assets"),"*.png").Count()==2;
                    if(seen)break;await Task.Delay(1);
                }
                Check(seen,"Did not observe real write stage before child completion");
                if(stage=="asset-before-commit"){
                    using var contended=new SnapshotStore(root);try{await contended.LoadAsync("document");throw new Exception("Production load bypassed active writer");}catch(SnapshotStoreException e)when(e.Code=="store_busy"){}
                }
            }
            Check(!child.HasExited,"Worker exited before controlled kill");child.Kill(entireProcessTree:false);await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(10));
        }finally{if(!child.HasExited){child.Kill(entireProcessTree:false);await child.WaitForExitAsync();}}
        if(stage=="partial-asset"){var partial=Directory.EnumerateFiles(Path.Combine(root,"assets"),".asset-*.tmp").Select(p=>new FileInfo(p).Length).ToArray();Check(partial.Length==1&&partial[0]>0&&partial[0]<large.Length,"Kill did not interrupt an actual partial asset file");observedBytes=partial[0];}
        Console.WriteLine("KILLED "+stage);
        Check((await error).Length==0,"Worker reported an unexpected error");
        using(var live=new SnapshotStore(root)){var recovered=await live.LoadAsync("document");Check(recovered.Revision==(stage=="committed"?2:1),"Surviving process recovered wrong revision");}
        Console.WriteLine("LIVE_API_RECOVERY "+stage);
        // 重启恢复由全新进程执行，避免把存活测试驱动的SQLite状态冒充一次应用重启。
        using(var verifier=StartWorker(root,"verify:"+stage,token)){
            var stdout=verifier.StandardOutput.ReadToEndAsync();var stderr=verifier.StandardError.ReadToEndAsync();
            try{await verifier.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(20));}finally{if(!verifier.HasExited){verifier.Kill(false);await verifier.WaitForExitAsync();}}
            Check(verifier.ExitCode==0,"Fresh recovery failed: "+await stderr);Console.WriteLine("VERIFIED "+await stdout);
        }
        return new{stage,childTerminated=true,survivingProcessLoad=true,coldProcessLoad=true,observedPartialAssetBytes=observedBytes,recoveredRevision=stage=="committed"?2:1,integrity="ok",orphanCleanup="passed",elapsedMs=watch.Elapsed.TotalMilliseconds};
    }
    private static async Task VerifyFresh(string root,string stage)
    {
        using(var connection=Connect(root)){using var command=connection.CreateCommand();Console.WriteLine("INTEGRITY "+stage);command.CommandText="PRAGMA integrity_check;";Check((string?)command.ExecuteScalar()=="ok","Database integrity failed after crash");command.CommandText="DROP TRIGGER IF EXISTS quality_pause;";command.ExecuteNonQuery();if(stage=="dirty-wal"){command.CommandText="SELECT COUNT(*) FROM quality_scratch;";Check(Convert.ToInt64(command.ExecuteScalar())==0,"Uncommitted spilled pages survived");}}
        using(var store=new SnapshotStore(root)){
            var restored=await store.LoadAsync("document");Check(restored.Revision==(stage=="committed"?2:1),"Crash recovered wrong revision");
            Check(restored.Document.GetProperty("editor").GetProperty("text").GetString()==(stage=="committed"?"new committed":"committed baseline"),"Crash recovered mixed metadata");
            if(stage!="committed")Check(restored.Document.GetProperty("image").GetProperty("dataUrl").GetString()==Document(NoisePng(3200,1800,3),"committed baseline").GetProperty("image").GetProperty("dataUrl").GetString(),"Baseline PNG hash changed after crash");
            Check(restored.Document.GetProperty("editor").GetProperty("translationData").GetProperty("chunks")[0].GetProperty("text").GetString()=="corrected","Translation correction lost after crash");
            await store.SaveAsync("document",3,restored.Document);Check(Directory.EnumerateFiles(Path.Combine(root,"assets"),".asset-*.tmp").Count()==0&&Directory.EnumerateFiles(Path.Combine(root,"assets"),"*.png").Count()==1,"Orphan assets not collected on next successful save");
            Check(File.ReadAllText(Path.Combine(root,"assets","unrelated.txt")).StartsWith("owned"),"Collector touched unrelated sentinel");
        }
        Console.WriteLine("integrity=ok; revision="+(stage=="committed"?2:1)+"; immutableImage=ok; orphanCleanup=ok");
    }
    private static Process StartWorker(string root,string stage,string token)
    {
        var info=new ProcessStartInfo(Environment.ProcessPath!){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
        if(Path.GetFileNameWithoutExtension(Environment.ProcessPath!).Equals("dotnet",StringComparison.OrdinalIgnoreCase))info.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);foreach(var argument in new[]{"--quality-worker",root,stage,token})info.ArgumentList.Add(argument);
        return Process.Start(info)??throw new Exception("Worker failed to start");
    }
    private static SqliteConnection Connect(string root){var c=new SqliteConnection(new SqliteConnectionStringBuilder{DataSource=Path.Combine(root,"snapshots.db"),Pooling=false,DefaultTimeout=2}.ToString());c.Open();return c;}
    private static async Task Worker(string root,string stage,string token)
    {
        var absolute=Path.GetFullPath(root);var temporary=Path.TrimEndingDirectorySeparator(Path.GetTempPath())+Path.DirectorySeparatorChar;
        Check(absolute.StartsWith(temporary,StringComparison.OrdinalIgnoreCase)&&Path.GetRelativePath(temporary,absolute).StartsWith("Screenshot-quality-",StringComparison.Ordinal)&&File.ReadAllText(Path.Combine(absolute,".quality-owner"))==token,"Refuse worker outside owned temporary root");
        if(stage.StartsWith("verify:",StringComparison.Ordinal)){await VerifyFresh(root,stage[7..]);return;}
        if(stage=="dirty-wal"){
            using var connection=Connect(root);using var command=connection.CreateCommand();command.CommandText="PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=8; BEGIN IMMEDIATE; UPDATE snapshots SET revision=2 WHERE document_id='document';";command.ExecuteNonQuery();
            command.CommandText="INSERT INTO quality_scratch(payload) VALUES(zeroblob(65536));";for(var i=0;i<24;i++)command.ExecuteNonQuery();Console.WriteLine("DIRTY");Console.Out.Flush();await Task.Delay(Timeout.Infinite);return;
        }
        using var store=new SnapshotStore(root);await store.SaveAsync("document",2,Document(NoisePng(3200,1800,17),"new committed"));Console.WriteLine("COMMITTED");Console.Out.Flush();await Task.Delay(Timeout.Infinite);
    }
    // 有效RGB噪声PNG；固定种子，只在内存生成，不读取任何截图或用户文件。
    private static byte[] NoisePng(int width,int height,int seed)
    {
        using var output=new MemoryStream();output.Write(new byte[]{137,80,78,71,13,10,26,10});var header=new byte[13];BinaryPrimitives.WriteInt32BigEndian(header,width);BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4),height);header[8]=8;header[9]=2;Chunk(output,"IHDR",header);
        using var compressed=new MemoryStream();using(var zlib=new ZLibStream(compressed,CompressionLevel.Fastest,true)){var row=new byte[width*3+1];var random=new Random(seed);for(var y=0;y<height;y++){random.NextBytes(row.AsSpan(1));zlib.Write(row);}}
        Chunk(output,"IDAT",compressed.ToArray());Chunk(output,"IEND",Array.Empty<byte>());return output.ToArray();
    }
    private static void Chunk(Stream target,string name,byte[] bytes){Span<byte> length=stackalloc byte[4];BinaryPrimitives.WriteInt32BigEndian(length,bytes.Length);target.Write(length);var type=System.Text.Encoding.ASCII.GetBytes(name);target.Write(type);target.Write(bytes);uint crc=0xffffffff;foreach(var b in type)crc=Crc[(crc^b)&255]^(crc>>8);foreach(var b in bytes)crc=Crc[(crc^b)&255]^(crc>>8);BinaryPrimitives.WriteUInt32BigEndian(length,crc^0xffffffff);target.Write(length);}
    private static readonly uint[] Crc=Enumerable.Range(0,256).Select(i=>{uint c=(uint)i;for(var j=0;j<8;j++)c=(c&1)!=0?0xedb88320^(c>>1):c>>1;return c;}).ToArray();
}
