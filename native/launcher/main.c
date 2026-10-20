// 根目录的 Windows 原生入口：只定位 app 内的宿主，不要求另装 .NET 或 VC++ 运行时。
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <strsafe.h>

// 转发原始参数并使用宿主目录作为工作目录；检查模式只检查文件，供后台打包验证。
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR arguments, int show)
{
    UNREFERENCED_PARAMETER(instance); UNREFERENCED_PARAMETER(previous); UNREFERENCED_PARAMETER(show);
    WCHAR executable[32768], command[32768], message[512];
    DWORD length = GetModuleFileNameW(NULL, executable, ARRAYSIZE(executable));
    BOOL check = lstrcmpW(arguments, L"--check-package") == 0;
    if (!length || length >= ARRAYSIZE(executable)) return 2;
    WCHAR *separator = wcsrchr(executable, L'\\');
    if (!separator) return 2;
    *separator = L'\0';
    if (FAILED(StringCchCatW(executable, ARRAYSIZE(executable), L"\\app\\Screenshot.exe"))) return 2;
    DWORD attributes = GetFileAttributesW(executable);
    if (check) return attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_DIRECTORY) ? 0 : 2;
    if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_DIRECTORY)) {
        MessageBoxW(NULL, L"未找到 app\\Screenshot.exe。请先完整解压下载包，再双击根目录的 Screenshot.exe。", L"Screenshot · 无法启动", MB_OK | MB_ICONERROR);
        return 2;
    }
    if (FAILED(StringCchPrintfW(command, ARRAYSIZE(command), L"\"%s\" %s", executable, arguments))) return 2;
    // 禁止当前目录参与 DLL 搜索；启动路径固定，文件名和参数不交给命令解释器。
    SetDllDirectoryW(L"");
    STARTUPINFOW startup = { sizeof(startup) };
    PROCESS_INFORMATION process = { 0 };
    WCHAR directory[32768];
    StringCchCopyW(directory, ARRAYSIZE(directory), executable);
    *wcsrchr(directory, L'\\') = L'\0';
    if (!CreateProcessW(executable, command, NULL, NULL, FALSE, 0, NULL, directory, &startup, &process)) {
        StringCchPrintfW(message, ARRAYSIZE(message), L"无法启动 Screenshot（Windows 错误 %lu）。请确认已完整解压；仍失败时请运行 app 内的 diagnose-portable.ps1。", GetLastError());
        MessageBoxW(NULL, message, L"Screenshot · 无法启动", MB_OK | MB_ICONERROR);
        return 1;
    }
    CloseHandle(process.hThread); CloseHandle(process.hProcess);
    return 0;
}
