using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using OpenCvSharp;
using Screenshot.Ocr;

// Isolated synthetic-only benchmark; the library override exists only in this test executable.
internal static class NativeOcrQuality
{
    private static void Check(bool value,string message){if(!value)throw new Exception(message);}
    public static async Task<int> Run(string[] args)
    {
        try{
            if(args.Length!=5)throw new ArgumentException("Use --native-quality REPORT MODEL_DIRECTORY NATIVE_DLL EXPECTED_SHA256");
            var library=Path.GetFullPath(args[3]);var hash=Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(library))).ToLowerInvariant();
            Check(hash==args[4],"Native library checksum mismatch");
            var handle=NativeLibrary.Load(library);
            NativeLibrary.SetDllImportResolver(typeof(Mat).Assembly,(name,assembly,search)=>name.Contains("OpenCvSharpExtern",StringComparison.Ordinal)?handle:IntPtr.Zero);
            Cv2.SetNumThreads(1);
            using var process=Process.GetCurrentProcess();process.Refresh();long peakPrivate=process.PrivateMemorySize64,peakWorking=process.WorkingSet64;
            using var sampling=new CancellationTokenSource();var sampler=Task.Run(async()=>{while(!sampling.IsCancellationRequested){process.Refresh();peakPrivate=Math.Max(peakPrivate,process.PrivateMemorySize64);peakWorking=Math.Max(peakWorking,process.WorkingSet64);try{await Task.Delay(20,sampling.Token);}catch(OperationCanceledException){break;}}});
            var cases=new List<object>();using var service=new LocalOcrService(Path.GetFullPath(args[2]));Check(service.GetStatus().Available,"Pinned OCR models unavailable");
            foreach(var large in new[]{false,true}){
                var png=TextPng(large);var warmup=await service.RecognizeAsync(png);Check(warmup.Text.Contains("Hello")&&warmup.Text.Contains("123")&&warmup.Text.Contains("中文"),"Synthetic OCR reference not recognized");
                var times=new List<double>();var allocations=new List<long>();OcrDocument last=warmup;
                for(var i=0;i<5;i++){var allocated=GC.GetTotalAllocatedBytes(true);var watch=Stopwatch.StartNew();last=await service.RecognizeAsync(png);times.Add(watch.Elapsed.TotalMilliseconds);allocations.Add(GC.GetTotalAllocatedBytes(true)-allocated);Check(last.Text==warmup.Text&&last.Blocks.Select(b=>b.Id).SequenceEqual(warmup.Blocks.Select(b=>b.Id)),"Repeated synthetic OCR differs");}
                cases.Add(new{kind=large?"large-text":"small-text",inputSha256=Convert.ToHexString(SHA256.HashData(png)).ToLowerInvariant(),pngBytes=png.Length,result=last,milliseconds=times,managedAllocationBytes=allocations});
            }
            var noise=NoisePng();var decodeTimes=new List<double>();string? pixelHash=null;var tensorSamples=new List<float>();
            for(var i=-1;i<5;i++){
                var watch=Stopwatch.StartNew();using var image=PngInput.DecodeToBgr(noise,CancellationToken.None);var input=OcrAlgorithms.PrepareDetection(image,CancellationToken.None);watch.Stop();
                if(i>=0)decodeTimes.Add(watch.Elapsed.TotalMilliseconds);Check(image.Width==3200&&image.Height==1800&&image.IsContinuous(),"Large PNG decode geometry differs");
                if(i==4){var pixels=new byte[3200*1800*3];Marshal.Copy(image.Data,pixels,0,pixels.Length);pixelHash=Convert.ToHexString(SHA256.HashData(pixels)).ToLowerInvariant();tensorSamples.AddRange(input.Data.Where((_,index)=>index%200003==0));}
            }
            sampling.Cancel();await sampler;GC.Collect();GC.WaitForPendingFinalizers();GC.Collect();process.Refresh();
            var report=new{schemaVersion=1,syntheticOnly=true,desktopAccess=false,nativeSha256=hash,nativeBytes=new FileInfo(library).Length,buildInfo=Cv2.GetBuildInformation(),samplesPerCase=5,cases,largePng=new{width=3200,height=1800,pngBytes=noise.Length,inputSha256=Convert.ToHexString(SHA256.HashData(noise)).ToLowerInvariant(),pixelSha256=pixelHash,tensorSamples,milliseconds=decodeTimes},memory=new{sampledPeakPrivateBytes=peakPrivate,sampledPeakWorkingBytes=peakWorking,afterGcPrivateBytes=process.PrivateMemorySize64,samplingIntervalMs=20},scope="Same test driver and pinned CPU models; warmup excluded. Synthetic in-memory text/noise. Independent process per library; sampled memory and five observations are not a latency guarantee."};
            var text=JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true});Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(args[1]))!);await File.WriteAllTextAsync(args[1],text);Console.WriteLine("PASS native OCR quality "+hash+"; 2 actual-model text cases, large PNG pixel/tensor checks, 5 timed samples each");return 0;
        }catch(Exception e){Console.Error.WriteLine("FAIL native OCR quality: "+e.GetType().Name+" "+e.Message);return 1;}
    }
    // Only memory-backed GDI+ bitmaps; no screen reads, windows, dialogs or clipboard.
    private static byte[] TextPng(bool large)
    {
        using var bitmap=new Bitmap(large?1920:900,large?1080:260,PixelFormat.Format24bppRgb);using var graphics=Graphics.FromImage(bitmap);graphics.Clear(Color.White);graphics.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;
        using var font=new Font("Microsoft YaHei UI",large?64:40,FontStyle.Regular,GraphicsUnit.Pixel);using var brush=new SolidBrush(Color.Black);
        for(var row=0;row<(large?8:2);row++)graphics.DrawString(row%2==0?"Hello OCR 123":"中文截图测试",font,brush,35,35+row*(large?120:100));
        using var output=new MemoryStream();bitmap.Save(output,ImageFormat.Png);return output.ToArray();
    }
    private static byte[] NoisePng()
    {
        using var bitmap=new Bitmap(3200,1800,PixelFormat.Format24bppRgb);var data=bitmap.LockBits(new Rectangle(0,0,3200,1800),ImageLockMode.WriteOnly,PixelFormat.Format24bppRgb);
        try{var bytes=new byte[data.Stride*1800];new Random(17).NextBytes(bytes);Marshal.Copy(bytes,0,data.Scan0,bytes.Length);}finally{bitmap.UnlockBits(data);}
        using var output=new MemoryStream();bitmap.Save(output,ImageFormat.Png);return output.ToArray();
    }
}
