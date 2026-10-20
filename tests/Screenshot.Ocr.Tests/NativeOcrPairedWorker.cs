using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using OpenCvSharp;
using Screenshot.Ocr;

// 两种原生库分属常驻子进程；只有控制器点名时测量，不并行推理或访问桌面。
internal static class NativeOcrPairedWorker
{
    internal static async Task<int> RunAsync(string[] args)
    {
        try
        {
            if (args.Length != 5) throw new ArgumentException("Use --native-quality-worker MODELS DLL SHA256 PROFILE");
            var library = Path.GetFullPath(args[2]); var profile = args[4];
            if (profile is not ("vendor" or "source")) throw new ArgumentException("Invalid profile");
            var hash = Convert.ToHexStringLower(SHA256.HashData(await File.ReadAllBytesAsync(library)));
            if (hash != args[3]) throw new InvalidDataException("Native library checksum mismatch");
            var handle = NativeLibrary.Load(library);
            NativeLibrary.SetDllImportResolver(typeof(Mat).Assembly, (name, _, _) => name.Contains("OpenCvSharpExtern", StringComparison.Ordinal) ? handle : IntPtr.Zero);
            Cv2.SetNumThreads(1);
            using var service = new LocalOcrService(Path.GetFullPath(args[1]));
            if (!service.GetStatus().Available) throw new InvalidDataException("Pinned OCR models unavailable");
            var inputs = new Dictionary<string, byte[]> {
                ["small-text"] = NativeOcrQuality.TextPng(false), ["large-text"] = NativeOcrQuality.TextPng(true),
                ["large-png-decode-and-detection-preprocess"] = NativeOcrQuality.NoisePng()
            };
            var hashes = inputs.ToDictionary(pair => pair.Key, pair => Convert.ToHexStringLower(SHA256.HashData(pair.Value)));
            // 元数据先回传，后续一行请求对应一行响应；所有时间序列都由控制器持久化。
            Write(new { kind = "ready", protocol = 2, profile, pid = Environment.ProcessId, nativeSha256 = hash, nativeBytes = new FileInfo(library).Length,
                buildInfo = Cv2.GetBuildInformation(), modelVersion = LocalOcrService.ModelVersion, tieredCompilation = Environment.GetEnvironmentVariable("DOTNET_TieredCompilation"), frequency = Stopwatch.Frequency, inputHashes = hashes });
            using var process = Process.GetCurrentProcess();
            while (await Console.In.ReadLineAsync() is string line)
            {
                using var request = JsonDocument.Parse(line); var command = request.RootElement;
                var operation = command.GetProperty("operation").GetString();
                if (operation == "exit") return 0;
                if (operation is not ("warmup" or "sample")) throw new InvalidDataException("Invalid worker operation");
                var scenario = command.GetProperty("scenario").GetString()!;
                if (!inputs.TryGetValue(scenario, out var png)) throw new InvalidDataException("Invalid worker scenario");
                object correctness; long end; var startedUtc = DateTimeOffset.UtcNow; var start = Stopwatch.GetTimestamp();
                if (scenario == "large-png-decode-and-detection-preprocess")
                {
                    using var image = PngInput.DecodeToBgr(png, CancellationToken.None);
                    var tensor = OcrAlgorithms.PrepareDetection(image, CancellationToken.None); end = Stopwatch.GetTimestamp();
                    if (image.Width != 3200 || image.Height != 1800 || !image.IsContinuous()) throw new InvalidDataException("Large PNG decode geometry differs");
                    // 哈希与采样不计入算法时间，仍对每次实际结果核验像素与张量。
                    var pixels = new byte[3200 * 1800 * 3]; Marshal.Copy(image.Data, pixels, 0, pixels.Length);
                    correctness = new { inputSha256 = hashes[scenario], pixelSha256 = Convert.ToHexStringLower(SHA256.HashData(pixels)),
                        tensorSamples = tensor.Data.Where((_, index) => index % 200003 == 0).ToArray() };
                }
                else
                {
                    var result = await service.RecognizeAsync(png); end = Stopwatch.GetTimestamp();
                    if (!result.Text.Contains("Hello") || !result.Text.Contains("123") || !result.Text.Contains("中文")) throw new InvalidDataException("Synthetic OCR reference not recognized");
                    correctness = new { inputSha256 = hashes[scenario], result };
                }
                process.Refresh();
                Write(new { kind = "measurement", id = command.GetProperty("id").GetInt32(), profile, pid = Environment.ProcessId, scenario,
                    phase = operation, startedUtc, start, end, frequency = Stopwatch.Frequency, milliseconds = (end - start) * 1000d / Stopwatch.Frequency,
                    correctness, privateBytes = process.PrivateMemorySize64, workingBytes = process.WorkingSet64 });
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("FAIL paired native worker: " + error.GetType().Name + " " + error.Message); return 1;
        }
    }
    private static void Write(object value) => Console.WriteLine(JsonSerializer.Serialize(value));
}
