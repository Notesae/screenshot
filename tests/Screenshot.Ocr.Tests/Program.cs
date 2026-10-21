using System.Buffers.Binary;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Security.Cryptography;
using System.Text.Json;
using OpenCvSharp;
using Screenshot.Ocr;
using CvPoint = OpenCvSharp.Point;
using DrawingColor = System.Drawing.Color;

// A fresh process proves metadata/status does not eagerly load the CPU native library.
if(args.Length==1&&args[0]=="--native-status"){
    using var service=new LocalOcrService(Path.Combine(AppContext.BaseDirectory,"absent-models-status"));
    var status=service.GetStatus();using var current=Process.GetCurrentProcess();
    if(status.Available||current.Modules.Cast<ProcessModule>().Any(m=>m.ModuleName.Equals("OpenCvSharpExtern.dll",StringComparison.OrdinalIgnoreCase))){Console.Error.WriteLine("FAIL native status eagerly loaded native runtime");return 1;}
    Console.WriteLine("PASS status query leaves native OCR runtime unloaded");return 0;
}

if(args.Length>0&&args[0]=="--native-quality")return await NativeOcrQuality.Run(args);
if(args.Length>0&&args[0]=="--native-quality-worker")return await NativeOcrPairedWorker.RunAsync(args);

if(args.Length==2&&args[0]=="--build-info"){try{using var decoded=PngInput.DecodeToBgr(SyntheticPng("Hello","OCR 123"));await File.WriteAllTextAsync(Path.GetFullPath(args[1]),Cv2.GetBuildInformation());return 0;}catch(Exception error){Console.Error.WriteLine("FAIL native build metadata: "+error);return 1;}}

// 只使用内存生成的 PNG 和固定模型；不调用任何窗口、桌面或剪贴板接口。
var modelDirectory = Path.GetFullPath(args.FirstOrDefault(a => !a.StartsWith("--")) ?? "models/pp-ocrv5-mobile");
var runIntegration = args.Contains("--integration");
var tests = new List<(string Name, Func<Task> Work)>();
void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
void Near(double actual, double expected, double tolerance = .0001) => Check(Math.Abs(actual - expected) <= tolerance, $"Expected {expected}, got {actual}");
async Task Error(Func<Task> work, string code) { try { await work(); } catch (LocalOcrException e) { Check(e.Code == code, $"Expected {code}, got {e.Code}"); return; } throw new Exception("Expected " + code); }
void Test(string name, Action action) => tests.Add((name, () => { action(); return Task.CompletedTask; }));

// Source profile must load its audited DLL through the normal production resolver, not only the benchmark override.
var sourceManifest=Path.Combine(AppContext.BaseDirectory,"native-provenance","native-build.json");
if(File.Exists(sourceManifest))Test("Source native runtime matches audited binary and minimal feature profile",()=>{
    using var decoded=PngInput.DecodeToBgr(SyntheticPng("Hello","OCR 123"));
    using var manifest=JsonDocument.Parse(File.ReadAllText(sourceManifest));var expected=manifest.RootElement.GetProperty("binary").GetProperty("sha256").GetString();var info=Cv2.GetBuildInformation();
    using var current=Process.GetCurrentProcess();var native=current.Modules.Cast<ProcessModule>().Single(m=>m.ModuleName.Equals("OpenCvSharpExtern.dll",StringComparison.OrdinalIgnoreCase));
    Check(Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(native.FileName))).Equals(expected,StringComparison.OrdinalIgnoreCase),"Production resolver loaded a different native DLL");
    var modules=System.Text.RegularExpressions.Regex.Match(info,@"To be built:\s*([^\r\n]+)").Groups[1].Value.Split(' ',StringSplitOptions.RemoveEmptyEntries).Order().ToArray();
    Check(modules.SequenceEqual(new[]{"core","imgcodecs","imgproc"}),"Unexpected OpenCV module closure");
    Check(!System.Text.RegularExpressions.Regex.IsMatch(info,@"Intel IPP(?: IW)?:\s+(?!NO\b)"),"IPP/IW remains enabled");
    Check(!System.Text.RegularExpressions.Regex.IsMatch(info,@"OpenCL:\s+YES|Trace:\s+YES"),"Unexpected OpenCL/tracing support");
});

// 缺模型状态必须可查询，不能自动下载或泄漏用户图片内容。
tests.Add(("Missing models are explicit and never downloaded", async () => {
    var absent = Path.Combine(AppContext.BaseDirectory, "absent-models-" + Guid.NewGuid().ToString("N"));
    using var service = new LocalOcrService(absent);
    var status = service.GetStatus();
    Check(!status.Available && status.MissingFiles.Count == 2, "Missing status invalid");
    await Error(() => service.RecognizeAsync(SyntheticPng("Hello", "OCR 123")), "model_missing");
    Check(!Directory.Exists(absent), "Unexpected model download or directory creation");
}));
Test("PNG signature, dimensions and area are checked before decompression", () => {
    try { PngInput.ReadSize([1,2,3]); throw new Exception("Invalid header accepted"); } catch (LocalOcrException e) { Check(e.Code == "invalid_image", "Wrong image error"); }
    foreach (var (w,h) in new[] { (16001, 1), (8000,8000) }) {
        var header = new byte[33]; byte[] signature = [137,80,78,71,13,10,26,10]; signature.CopyTo(header,0);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(8),13); "IHDR"u8.CopyTo(header.AsSpan(12));
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(16),w); BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(20),h);
        try { PngInput.ReadSize(header); throw new Exception("Oversized PNG accepted"); } catch (LocalOcrException e) { Check(e.Code == "image_too_large", "Wrong size error"); }
    }
    var oversized=new byte[PngInput.MaxBytes+1];
    new byte[] {137,80,78,71,13,10,26,10}.CopyTo(oversized,0);
    BinaryPrimitives.WriteUInt32BigEndian(oversized.AsSpan(8),13); "IHDR"u8.CopyTo(oversized.AsSpan(12));
    try { PngInput.ReadSize(oversized); throw new Exception("Byte limit not enforced"); } catch(LocalOcrException e) { Check(e.Code=="image_too_large","Wrong byte limit error"); }
});
// 文件存在也必须匹配固定 SHA256；错误只含可读提示，不携带底层路径。
tests.Add(("Corrupted model checksums are rejected without exposing paths",async()=>{
    var directory=Path.Combine(AppContext.BaseDirectory,"corrupt-models-"+Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(directory);
    try {
        await File.WriteAllBytesAsync(Path.Combine(directory,"ch_PP-OCRv5_det_mobile.onnx"),[1,2,3]);
        await File.WriteAllBytesAsync(Path.Combine(directory,"ch_PP-OCRv5_rec_mobile.onnx"),[4,5,6]);
        using var service=new LocalOcrService(directory);
        var status=service.GetStatus();
        Check(!status.Available && status.MissingFiles.Count==0 && !status.Message.Contains(directory),"Invalid checksum status or private path leak");
        await Error(()=>service.RecognizeAsync(SyntheticPng("Hello","OCR 123")),"model_invalid");
    } finally {
        Check(Path.GetFullPath(directory).StartsWith(Path.GetFullPath(AppContext.BaseDirectory),StringComparison.OrdinalIgnoreCase),"Unsafe test cleanup target");
        Directory.Delete(directory,true);
    }
}));
Test("Transparent pixels composite onto white before OCR", () => {
    Cv2.SetNumThreads(1);
    using var transparent = new Mat(10,12,MatType.CV_8UC4,new Scalar(10,30,70,0));
    using var decoded = PngInput.DecodeToBgr(transparent.ToBytes(".png"));
    var pixel = decoded.At<Vec3b>(4,5);
    Check(pixel.Item0 == 255 && pixel.Item1 == 255 && pixel.Item2 == 255, "Transparent background became dark");
});
Test("Detector preserves BGR channels, normalization and multiple-of-32 geometry", () => {
    using var image = new Mat(35,70,MatType.CV_8UC3,new Scalar(255,0,0));
    var input = OcrAlgorithms.PrepareDetection(image,CancellationToken.None);
    Check(input.Width % 32 == 0 && input.Height % 32 == 0 && Math.Max(input.Width,input.Height) <= 960, "Invalid detector shape");
    Near(input.Data[0], (1-.485)/.229); Near(input.Data[input.Width*input.Height], (0-.456)/.224);
});
Test("Recognizer preserves aspect, uses 48 rows and zero normalized padding", () => {
    using var image = new Mat(24,48,MatType.CV_8UC3,new Scalar(255,0,0));
    var input = OcrAlgorithms.PrepareRecognition(image,CancellationToken.None);
    Check(input.Height == 48 && input.Width == 320, "Invalid recognition shape");
    Near(input.Data[0],1); Near(input.Data[48*320],-1); Near(input.Data[319],0);
});
Test("CTC removes adjacent repeats and blank, retaining raw confidence and spaces", () => {
    int[] indices = [1,1,0,1,2,2,3]; float[] probability = [.9f,.8f,.99f,.7f,.6f,.5f,.4f];
    var scores = new float[indices.Length*4];
    for (int i=0;i<indices.Length;i++) scores[i*4+indices[i]] = probability[i];
    var decoded = OcrAlgorithms.DecodeCtc(scores,indices.Length,4,["","A","中"," "],CancellationToken.None);
    Check(decoded.Text == "AA中 ", "CTC repeat/blank decoding failed: " + decoded.Text); Near(decoded.Confidence,.65);
});
Test("CTC rejects dictionary mismatch and nonfinite output without fabricated text",()=>{
    foreach(var scores in new[] {new float[2],new float[] {float.NaN,0,0,0}}) {
        try { OcrAlgorithms.DecodeCtc(scores,2,2,["","A"],CancellationToken.None); throw new Exception("Invalid CTC accepted"); }
        catch(LocalOcrException e) { Check(e.Code=="model_invalid","Wrong CTC shape/probability error"); }
    }
    var empty=OcrAlgorithms.DecodeCtc([1,0,1,0],2,2,["","A"],CancellationToken.None);
    Check(empty.Text=="" && empty.Confidence==0,"Blank CTC output invented text or confidence");
});
Test("Algorithm work observes cancellation before decoding",()=>{
    using var cts=new CancellationTokenSource(); cts.Cancel();
    try { OcrAlgorithms.DecodeCtc([.1f,.9f],1,2,["","A"],cts.Token); throw new Exception("Cancelled CTC continued"); }
    catch(OperationCanceledException) { }
});
Test("DB filters weak/tiny contours, expands polygon and returns source pixels", () => {
    var map = new float[64*64];
    for (int y=20;y<30;y++) for(int x=10;x<42;x++) map[y*64+x]=.9f;
    for (int y=2;y<10;y++) for(int x=40;x<60;x++) map[y*64+x]=.4f;
    map[50*64+50]=1;
    var boxes = OcrAlgorithms.ExtractBoxes(map,64,64,320,192,CancellationToken.None);
    Check(boxes.Count == 1,"Weak/tiny DB contours were not rejected");
    var box = boxes[0]; Check(box.Polygon.Min(p=>p.X)<50 && box.Polygon.Max(p=>p.X)>205,"DB unclip not mapped to source");
    Check(box.Polygon.All(p=>p.X>=0 && p.X<=319 && p.Y>=0 && p.Y<=191),"Coordinates outside source"); Near(box.DetectionConfidence,.9);
});
Test("Perspective crop rectifies quadrilateral and restores vertical orientation", () => {
    using var source = new Mat(100,200,MatType.CV_8UC3,Scalar.White);
    Cv2.Rectangle(source,new OpenCvSharp.Rect(20,20,120,40),Scalar.Black,-1);
    using var crop = OcrAlgorithms.Rectify(source,[new(20,20),new(140,20),new(140,60),new(20,60)]);
    Check(crop.Width == 120 && crop.Height == 40 && Cv2.Mean(crop).Val0<10,"Perspective crop geometry incorrect");
    using var vertical = OcrAlgorithms.Rectify(source,[new(20,10),new(40,10),new(40,90),new(20,90)]);
    Check(vertical.Width>vertical.Height,"Vertical line was not rotated for recognition");
});
Test("Reading order groups a line then sorts left to right", () => {
    DetectedBox Box(double x,double y)=>new([new(x,y),new(x+40,y),new(x+40,y+20),new(x,y+20)],.9);
    var ordered=OcrAlgorithms.SortReadingOrder([Box(100,8),Box(50,80),Box(10,10)]);
    Check(ordered[0].Polygon[0].X==10 && ordered[1].Polygon[0].X==100 && ordered[2].Polygon[0].Y==80,"Reading order incorrect");
});
Test("Block IDs are image-specific and stable under subpixel quantization", () => {
    OcrPoint[] polygon=[new(10,10),new(40,10),new(40,30),new(10,30)];
    var hash=SHA256.HashData([1,2,3]);
    var first=OcrAlgorithms.CreateBlockId(hash,polygon,0);
    Check(first==OcrAlgorithms.CreateBlockId(hash,polygon.Select(p=>new OcrPoint(p.X+.01,p.Y+.01)).ToArray(),0),"Subpixel ID unstable");
    Check(first!=OcrAlgorithms.CreateBlockId(hash,polygon,1) && first!=OcrAlgorithms.CreateBlockId(SHA256.HashData([4]),polygon,0),"IDs collide across images/order");
});
Test("Block limit reports overflow instead of silently truncating content", () => {
    var map=new float[400*320];
    for(int i=0;i<257;i++) for(int y=4+i/20*20;y<10+i/20*20;y++) for(int x=4+i%20*19;x<15+i%20*19;x++) map[y*400+x]=.95f;
    try { OcrAlgorithms.ExtractBoxes(map,400,320,400,320,CancellationToken.None); throw new Exception("Too many blocks accepted"); }
    catch(LocalOcrException e) { Check(e.Code=="too_many_blocks","Wrong block limit error"); }
});
tests.Add(("Pre-cancelled request does not load missing models", async () => {
    using var service=new LocalOcrService(Path.Combine(AppContext.BaseDirectory,"no-models"));
    using var token=new CancellationTokenSource(); token.Cancel();
    await Error(()=>service.RecognizeAsync(SyntheticPng("Hello","OCR 123"),token.Token),"cancelled");
}));

// 真实模型推理仅由显式 --integration 开启，输入仍只来自合成中英文字。
if(runIntegration) {
    tests.Add(("Fixed PP-OCRv5 CPU models recognize synthetic English and Chinese", async () => {
        using var service=new LocalOcrService(modelDirectory);
        Check(service.GetStatus().Available,"Fixed models unavailable");
        var png=SyntheticPng("Hello OCR 123","中文截图测试");
        var watch=Stopwatch.StartNew(); var result=await service.RecognizeAsync(png); watch.Stop();
        Console.WriteLine("SYNTHETIC_OCR "+JsonSerializer.Serialize(new { result.Text, result.Blocks, elapsedMilliseconds=watch.ElapsedMilliseconds }));
        await File.WriteAllBytesAsync(Path.Combine(AppContext.BaseDirectory,"synthetic-ocr-input.png"),png);
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory,"synthetic-ocr-result.json"),JsonSerializer.Serialize(new {
            expectedText="Hello OCR 123\n中文截图测试",modelDirectoryName="pp-ocrv5-mobile",intraOpThreads=2,interOpThreads=1,openCvThreads=1,
            result,elapsedMilliseconds=watch.ElapsedMilliseconds
        },new JsonSerializerOptions { WriteIndented=true }));
        Check(result.Text.Contains("Hello") && result.Text.Contains("123") && result.Text.Contains("中文") && result.Text.Contains("测试"),"Actual OCR differs from synthetic reference: "+result.Text);
        Check(result.ImageWidth==900 && result.ImageHeight==260 && result.Blocks.Count>=2,"Invalid actual OCR geometry");
        Check(result.Blocks.All(b=>b.Confidence is >=0 and <=1 && b.Polygon.Count==4 && b.Polygon.All(p=>p.X>=0 && p.X<900 && p.Y>=0 && p.Y<260)),"Invalid actual confidence or coordinates");
        var again=await service.RecognizeAsync(png);
        Check(result.Blocks.Select(b=>b.Id).SequenceEqual(again.Blocks.Select(b=>b.Id)),"Repeated OCR IDs changed");
        // 先提交请求并确认仍在进行，再立即取消；不假设热推理一定比30ms慢。
        using var cts=new CancellationTokenSource();var inFlight=service.RecognizeAsync(png,cts.Token);
        Check(!inFlight.IsCompleted,"Synthetic request unexpectedly completed before cancellation checkpoint");
        var cancellationWatch=Stopwatch.StartNew();cts.Cancel();await Error(()=>inFlight,"cancelled");cancellationWatch.Stop();
        Check(cancellationWatch.Elapsed<TimeSpan.FromSeconds(5),"Cancellation kept running too long");
        var recovered=await service.RecognizeAsync(png); Check(recovered.Text.Contains("中文"),"Inference did not recover after cancellation");
        using var blank=new Mat(260,900,MatType.CV_8UC3,Scalar.White);
        var empty=await service.RecognizeAsync(blank.ToBytes(".png")); Check(empty.Blocks.Count==0 && empty.Text=="","Blank image produced fabricated text");
        Console.WriteLine($"CANCELLATION elapsedMilliseconds={cancellationWatch.ElapsedMilliseconds}; blankBlocks={empty.Blocks.Count}");
    }));
}
int failed=0;
foreach(var (name,work) in tests) {
    try { await work(); Console.WriteLine("PASS "+name); }
    catch(Exception error) { failed++; Console.WriteLine("FAIL "+name+": "+error.Message); }
}
Console.WriteLine($"OCR checks: {tests.Count-failed}/{tests.Count} passed; realInference={runIntegration}");
return failed==0?0:1;

// GDI+ 仅在内存 Bitmap 上绘制固定字符串，不创建窗体、不读取屏幕。
static byte[] SyntheticPng(string english,string chinese) {
    using var bitmap=new Bitmap(900,260,PixelFormat.Format24bppRgb);
    using var graphics=Graphics.FromImage(bitmap);
    graphics.Clear(DrawingColor.White); graphics.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;
    using var font=new Font("Microsoft YaHei UI",40,FontStyle.Regular,GraphicsUnit.Pixel);
    using var brush=new SolidBrush(DrawingColor.Black);
    graphics.DrawString(english,font,brush,35,35); graphics.DrawString(chinese,font,brush,35,135);
    using var output=new MemoryStream(); bitmap.Save(output,ImageFormat.Png); return output.ToArray();
}
