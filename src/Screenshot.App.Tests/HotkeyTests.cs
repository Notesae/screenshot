using System.IO;
using Screenshot.App;
internal static class HotkeyTests
{
    public static int Run()
    {
        var count=0;void Check(bool ok,string text){if(!ok)throw new Exception(text);count++;}
        var d=HotkeyBinding.Default;Check(d.Modifiers==0x4006&&d.VirtualKey==0x53,"default keeps Ctrl Shift S with no-repeat");
        Check((d with{Key="F11"}).Validate().VirtualKey==0x7A,"function key maps correctly");
        foreach(var bad in new[]{d with{Key="F12"},d with{Key="WIN"},d with{Key="F01"},d with{Ctrl=false,Alt=false}}){try{bad.Validate();throw new Exception("invalid hotkey accepted");}catch(InvalidOperationException){count++;}}
        var fake=new Fake();using var manager=new HotkeyManager(fake);var saved=0;
        Check(manager.Apply(d,_=>saved++).Registered&&saved==1,"initial fake registration succeeds");var first=fake.LastId;
        fake.Conflict=true;var next=d with{Key="Q",Alt=true};var failed=manager.Apply(next,_=>saved++);
        Check(!failed.Applied&&failed.Binding==d&&manager.ShouldTrigger(first)&&saved==1,"conflict preserves existing registration and settings");
        fake.Conflict=false;Check(manager.Apply(d,_=>{}).Message.Contains("区域截图"),"reapplying retained binding clears stale conflict warning");var io=manager.Apply(next,_=>throw new IOException());Check(!io.Applied&&io.Binding==d&&manager.ShouldTrigger(first)&&fake.Active.Count==1,"save failure rolls back tentative registration");
        var changed=manager.Apply(next,_=>saved++);Check(changed.Applied&&changed.Binding==next&&fake.Active.Count==1&&!manager.ShouldTrigger(first),"successful replacement switches identity and releases old binding");
        var id=fake.LastId;manager.Apply(next with{Enabled=false},_=>saved++);Check(!manager.ShouldTrigger(id)&&fake.Active.Count==0,"disable releases registration");
        var folder=Path.Combine(Path.GetTempPath(),"Screenshot-hotkey-tests",Guid.NewGuid().ToString("N"));var file=Path.Combine(folder,"hotkey.json");var store=new HotkeySettingsStore(file);
        Check(store.Load().Binding==d,"missing settings do not write a file");store.Save(next);Check(store.Load().Binding==next,"atomic persisted settings roundtrip");
        File.WriteAllText(file,"corrupt");var corrupt=store.Load();Check(corrupt.Binding==d&&corrupt.Message.Length>0&&File.ReadAllText(file)=="corrupt","corrupt file returns warning without overwriting");
        var releaseFailure=new Fake();using var pending=new HotkeyManager(releaseFailure);pending.Apply(d,_=>{});var oldId=releaseFailure.LastId;releaseFailure.FailUnregister=true;
        Check(pending.Apply(next,_=>{}).CleanupPending&&!pending.ShouldTrigger(oldId),"unreleased old ID never triggers new capture");
        Check(!pending.Apply(d,_=>{}).Applied,"new changes blocked while stale registration cannot be released");
        releaseFailure.FailUnregister=false;Check(pending.Apply(next with{Enabled=false},_=>{}).Applied&&releaseFailure.Active.Count==0,"later successful cleanup permits explicit disable");
        var rollback=new Fake();using var rolled=new HotkeyManager(rollback);rolled.Apply(d,_=>{});var retained=rollback.LastId;rollback.FailUnregister=true;var rollbackState=rolled.Apply(next,_=>throw new IOException());
        Check(!rollbackState.Applied&&rollbackState.CleanupPending&&rolled.ShouldTrigger(retained)&&!rolled.ShouldTrigger(rollback.LastId),"failed persistence with failed cleanup retains only original active identity");
        return count;
    }
    private sealed class Fake:IHotkeyRegistration
    {
        internal bool Conflict,FailUnregister;internal int LastId;internal HashSet<int> Active=new();
        public bool Register(int id,HotkeyBinding binding){LastId=id;if(Conflict)return false;return Active.Add(id);}
        public bool Unregister(int id)=>!FailUnregister&&Active.Remove(id);
    }
}
