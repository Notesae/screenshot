using System;
using System.Runtime.InteropServices;
namespace Screenshot.App;
// 只由真实应用的UI生命周期构造；测试仅使用IHotkeyRegistration替身。
internal sealed class WindowsHotkeyRegistration(nint window):IHotkeyRegistration
{
    [DllImport("user32.dll",SetLastError=true)]private static extern bool RegisterHotKey(nint hwnd,int id,uint modifiers,uint key);
    [DllImport("user32.dll",SetLastError=true)]private static extern bool UnregisterHotKey(nint hwnd,int id);
    public bool Register(int id,HotkeyBinding binding)=>RegisterHotKey(window,id,binding.Modifiers,binding.VirtualKey);
    public bool Unregister(int id)=>UnregisterHotKey(window,id);
}
