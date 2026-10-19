using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Screenshot.AI;

/// <summary>串行读写当前账户的服务配置，仅持久化 DPAPI 保护后的密钥。</summary>
public sealed class AiSettingsStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };
    // 同一存储实例串行访问，避免读取与原子替换互相覆盖。
    private readonly SemaphoreSlim _gate = new(1, 1);
    public string FilePath { get; }

    public AiSettingsStore(string? filePath = null)
    {
        FilePath = filePath ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Screenshot", "providers.json");
    }

    // 在同一次锁定中读取和可选更新配置，以临时文件原子替换并清理失败写入。
    internal async Task<T> AccessAsync<T>(Func<StoredSettings, Task<(T Result, StoredSettings? Save)>> action, CancellationToken token)
    {
        await _gate.WaitAsync(token);
        try
        {
            StoredSettings settings;
            if (File.Exists(FilePath))
            {
                var info = new FileInfo(FilePath);
                if (info.Length > 1024 * 1024) throw new AiProviderException("invalid_settings", "服务商配置文件过大，请检查本地配置。");
                settings = JsonSerializer.Deserialize<StoredSettings>(await File.ReadAllTextAsync(FilePath, token), JsonOptions)
                    ?? throw new JsonException();
                if (settings.Providers is null || settings.Providers.Any(p => p is null)) throw new JsonException();
            }
            else settings = new([], null);
            var result = await action(settings);
            if (result.Save is not null)
            {
                var directory = Path.GetDirectoryName(Path.GetFullPath(FilePath))!;
                Directory.CreateDirectory(directory);
                var temporary = Path.Combine(directory, $"providers-{Guid.NewGuid():N}.tmp");
                try
                {
                    await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(result.Save, JsonOptions), token);
                    File.Move(temporary, FilePath, true);
                }
                finally { if (File.Exists(temporary)) File.Delete(temporary); }
            }
            return result.Result;
        }
        catch (JsonException) { throw new AiProviderException("invalid_settings", "服务商配置文件格式无效，请检查本地配置。"); }
        catch (UnauthorizedAccessException) { throw new AiProviderException("settings_access_denied", "无法访问本地服务商配置，请检查文件权限。"); }
        catch (IOException) { throw new AiProviderException("settings_io_error", "无法读取或保存本地服务商配置，请稍后重试。"); }
        finally { _gate.Release(); }
    }

    // 密钥绑定当前 Windows 账户；明文不会序列化到磁盘。
    internal static string Protect(string value) => Convert.ToBase64String(Dpapi(Encoding.UTF8.GetBytes(value), true));
    // 将当前账户密文还原为内存中的密钥，损坏密文只返回配置提示。
    internal static string Unprotect(string value)
    {
        try { return Encoding.UTF8.GetString(Dpapi(Convert.FromBase64String(value), false)); }
        catch (FormatException) { throw new AiProviderException("secret_unavailable", "无法解密服务商密钥，请在设置中重新填写。"); }
    }

    // 调用当前账户 DPAPI；结束后清零托管输入和原生缓冲区并释放系统内存。
    private static byte[] Dpapi(byte[] input, bool protect)
    {
        var pointer = Marshal.AllocHGlobal(input.Length);
        Blob output = default;
        try
        {
            Marshal.Copy(input, 0, pointer, input.Length);
            var blob = new Blob { Length = input.Length, Data = pointer };
            bool ok = protect
                ? CryptProtectData(ref blob, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output)
                : CryptUnprotectData(ref blob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out output);
            if (!ok) throw new AiProviderException("secret_unavailable", "无法使用当前 Windows 账户保护或解密密钥，请重新配置。");
            var result = new byte[output.Length];
            Marshal.Copy(output.Data, result, 0, output.Length);
            return result;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(input);
            if (pointer != IntPtr.Zero)
            {
                for (int i = 0; i < input.Length; i++) Marshal.WriteByte(pointer, i, 0);
                Marshal.FreeHGlobal(pointer);
            }
            if (output.Data != IntPtr.Zero)
            {
                for (int i = 0; i < output.Length; i++) Marshal.WriteByte(output.Data, i, 0);
                LocalFree(output.Data);
            }
        }
    }

    // 对应 Windows DATA_BLOB，用于在托管与 DPAPI 之间传递字节缓冲区。
    [StructLayout(LayoutKind.Sequential)] private struct Blob { public int Length; public IntPtr Data; }
    // 保护密钥，未设置 LOCAL_MACHINE 标志，因此绑定当前 Windows 账户。
    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CryptProtectData(ref Blob input, string? description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);
    // 使用当前 Windows 账户解密，禁止弹出系统交互提示。
    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, uint flags, out Blob output);
    // DPAPI 输出由系统分配，必须使用 LocalFree 归还。
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
}
