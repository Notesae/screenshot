using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;

namespace Screenshot.App;
internal sealed record HotkeyBinding(bool Enabled,bool Ctrl,bool Alt,bool Shift,string Key)
{
    internal static HotkeyBinding Default=>new(true,true,false,true,"S");
    internal uint Modifiers=>0x4000u|(Ctrl?2u:0)|(Alt?1u:0)|(Shift?4u:0);
    internal uint VirtualKey=>Key.Length==1?Key[0]:0x70u+uint.Parse(Key[1..],CultureInfo.InvariantCulture)-1;
    internal string Label=>(Ctrl?"Ctrl + ":"")+(Alt?"Alt + ":"")+(Shift?"Shift + ":"")+Key;
    internal HotkeyBinding Validate()
    {
        var key=Key?.ToUpperInvariant()??"";
        var character=key.Length==1&&(key[0] is >= 'A' and <= 'Z' or >= '0' and <= '9');
        var function=key.Length is 2 or 3&&key[0]=='F'&&int.TryParse(key[1..],NumberStyles.None,CultureInfo.InvariantCulture,out var n)&&n is >=1 and <=11&&key=="F"+n;
        if((!character&&!function)||(Enabled&&!Ctrl&&!Alt))throw new InvalidOperationException("快捷键需包含 Ctrl 或 Alt，按键支持字母、数字、F1–F11；F12和系统Win组合不开放。");
        return this with {Key=key};
    }
    internal static HotkeyBinding Parse(JsonElement value)
    {
        bool Flag(string name){if(!value.TryGetProperty(name,out var v)||v.ValueKind is not(JsonValueKind.True or JsonValueKind.False))throw new InvalidOperationException("快捷键参数无效。");return v.GetBoolean();}
        if(value.ValueKind!=JsonValueKind.Object||!value.TryGetProperty("key",out var key)||key.ValueKind!=JsonValueKind.String)throw new InvalidOperationException("快捷键参数无效。");
        return new HotkeyBinding(Flag("enabled"),Flag("ctrl"),Flag("alt"),Flag("shift"),key.GetString()!).Validate();
    }
}
internal interface IHotkeyRegistration{bool Register(int id,HotkeyBinding binding);bool Unregister(int id);}
internal sealed record HotkeyStatus(HotkeyBinding Binding,bool Registered,bool Applied,string Message,bool CleanupPending=false);
// 新组合先在另一个ID试注册，冲突或保存失败均保留原组合；没有测试逻辑调用Win32。
internal sealed class HotkeyManager(IHotkeyRegistration registration):IDisposable
{
    private const int FirstId=0x5343,SecondId=0x5344;
    private readonly HashSet<int> _registered=new();
    private int? _active;
    public HotkeyStatus State{get;private set;}=new(HotkeyBinding.Default,false,false,"快捷键尚未注册。");
    public HotkeyStatus Apply(HotkeyBinding requested,Action<HotkeyBinding> persist)
    {
        var binding=requested.Validate();
        foreach(var id in new List<int>(_registered))if(id!=_active&&registration.Unregister(id))_registered.Remove(id);
        if(_registered.Count>(_active is null?0:1))return State=State with {Applied=false,CleanupPending=true,Message="上一组合尚未确认释放，请重启应用后再修改。"};
        if(_active is not null&&State.Binding==binding)
        {
            try{persist(binding);return State=State with {Applied=true,CleanupPending=false,Message=$"区域截图 · {binding.Label}"};}catch{return State=State with {Applied=false,Message="快捷键设置未能保存，当前组合保持不变。"};}
        }
        var slot=_active==FirstId?SecondId:FirstId;
        if(binding.Enabled&&!registration.Register(slot,binding))return State=State with {Applied=false,Message=$"快捷键 {binding.Label} 被占用或系统拒绝注册，原组合保持不变。"};
        if(binding.Enabled)_registered.Add(slot);
        try{persist(binding);}catch{
            if(binding.Enabled&&registration.Unregister(slot))_registered.Remove(slot);
            return State=State with {Applied=false,CleanupPending=_registered.Count>(_active is null?0:1),Message="快捷键设置未能保存，原组合保持不变。"};
        }
        if(_active is {} old&&registration.Unregister(old))_registered.Remove(old);
        _active=binding.Enabled?slot:null;
        var pending=_registered.Count>(binding.Enabled?1:0);
        return State=new(binding,binding.Enabled,true,pending?"新设置已保存，但旧组合未确认释放，请重启应用。":binding.Enabled?$"区域截图 · {binding.Label}":"区域截图全局快捷键已禁用。",pending);
    }
    public bool ShouldTrigger(int id)=>State.Binding.Enabled&&_active==id&&_registered.Contains(id);
    public void Dispose(){foreach(var id in _registered)registration.Unregister(id);_registered.Clear();_active=null;}
}
internal sealed class HotkeySettingsStore(string path)
{
    private static readonly JsonSerializerOptions Json=new(){PropertyNamingPolicy=JsonNamingPolicy.CamelCase};
    internal (HotkeyBinding Binding,string Message) Load()
    {
        if(!File.Exists(path))return(HotkeyBinding.Default,"");
        try{if(new FileInfo(path).Length>4096)throw new InvalidOperationException();using var doc=JsonDocument.Parse(File.ReadAllText(path));if(doc.RootElement.GetProperty("schemaVersion").GetInt32()!=1)throw new InvalidOperationException();return(HotkeyBinding.Parse(doc.RootElement.GetProperty("binding")),"");}
        catch(Exception e)when(e is IOException or UnauthorizedAccessException or JsonException or InvalidOperationException or KeyNotFoundException or FormatException){return(HotkeyBinding.Default,"快捷键配置不可读，暂用默认组合；原文件未覆盖。");}
    }
    internal void Save(HotkeyBinding value)
    {
        var binding=value.Validate();var directory=Path.GetDirectoryName(Path.GetFullPath(path))!;Directory.CreateDirectory(directory);
        var temporary=Path.Combine(directory,"hotkey-"+Guid.NewGuid().ToString("N")+".tmp");
        try{File.WriteAllText(temporary,JsonSerializer.Serialize(new{schemaVersion=1,binding},Json));File.Move(temporary,path,true);}finally{if(File.Exists(temporary))File.Delete(temporary);}
    }
}
