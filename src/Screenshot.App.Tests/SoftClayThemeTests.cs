using System.Windows;
using System.Windows.Controls;
using Screenshot.App;

// STA 线程只实例化 WPF 资源和模板，不 Show 窗口、不注入输入、不读取屏幕。
internal static class SoftClayThemeTests
{
    public static int Run()
    {
        Exception? failure=null;var checks=0;
        var thread=new Thread(()=>
        {
            try
            {
                void Check(bool value,string name){if(!value)throw new Exception(name);checks++;}
                var resources=new ResourceDictionary();SoftClayTheme.Install(resources);
                Check(SoftClayTheme.Color("mask").A==128&&SoftClayDrawing.Color("mask").A==128,"CSS mask alpha matches WPF and GDI");
                Check(SoftClayTheme.Number("motion","toast")==280,"shared native toast timing");
                var spring=SoftClayTheme.Spring();
                Check(Math.Abs(spring.Ease(0))<.001&&Math.Abs(spring.Ease(1)-1)<.001,"native shared spring has stable endpoints");
                // 菜单只装载模板与矢量图标，不显示 Popup 或触发系统托盘。
                var menu=SoftClayTrayMenu.Create();Check(menu.ApplyTemplate()&&menu.MinWidth>=280,"tray uses custom rounded menu template");
                var executed=0;var command=SoftClayTrayMenu.Command("合成命令","M3 3h18v18H3z",()=>executed++,"Ctrl + Shift + S");
                command.Resources.MergedDictionaries.Add(menu.Resources);command.Style=(Style)menu.Resources["ClayTrayItem"];
                Check(command.ApplyTemplate()&&command.Icon is Viewbox&&executed==0,"tray commands keep vector icon and wait for activation");
                command.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));Check(executed==1&&command.InputGestureText=="Ctrl + Shift + S","tray menu command and shortcut remain available");
                var separator=SoftClayTrayMenu.Divider(menu);Check(separator.ApplyTemplate(),"tray group separator uses custom template");
                foreach(var type in new[]{typeof(TextBox),typeof(PasswordBox),typeof(RichTextBox),typeof(CheckBox),typeof(ComboBox),typeof(ComboBoxItem),typeof(ListBoxItem),typeof(TabControl),typeof(TabItem),typeof(Button),typeof(ProgressBar),typeof(System.Windows.Controls.Primitives.ScrollBar)})
                {
                    var control=(Control)Activator.CreateInstance(type)!;
                    control.Resources.MergedDictionaries.Add(resources);control.Style=(Style)resources[type];
                    if(control is ContentControl item)item.Content="合成选项";
                    Check(control.ApplyTemplate(),"custom native template loads: "+type.Name);
                    if(control is ListBoxItem or ComboBoxItem)Check(control.Template.FindName("ItemContent",control) is ContentPresenter { Content: "合成选项" },"native item text remains visible");
                    if(control is TextBox or PasswordBox or RichTextBox)Check(control.Template.FindName("PART_ContentHost",control) is ScrollViewer,"native text host preserved");
                    if(control is ComboBox)Check(control.Template.FindName("PART_Popup",control) is System.Windows.Controls.Primitives.Popup,"native keyboard dropdown part preserved");
                }
            }
            catch(Exception error){failure=error;}
        });
        thread.SetApartmentState(ApartmentState.STA);thread.Start();thread.Join();
        if(failure is not null)throw new Exception("Native theme resource regression",failure);
        return checks;
    }
}
