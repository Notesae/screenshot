using System.Windows.Media;
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
                foreach (var rate in new[] { 30, 60, 144 })
                {
                    var disclosure = new DisclosureTransition(); disclosure.Redirect(1);
                    for (var frame = 0; frame < rate / 12 + 1; frame++) disclosure.Step(1d / rate);
                    var current = disclosure.Value; disclosure.Redirect(0);
                    Check(disclosure.Value == current && current > 0 && current <= 1, "native disclosure redirects from current height at " + rate);
                    for (var frame = 0; frame < rate; frame++) { disclosure.Step(1d / rate); Check(disclosure.Value >= 0 && disclosure.Value <= 1, "native disclosure height stays bounded"); }
                    Check(disclosure.Value == 0 && !disclosure.Moving, "native disclosure settles at " + rate);
                    disclosure.Redirect(1); disclosure.Step(double.PositiveInfinity);
                    Check(disclosure.Value == 1 && !disclosure.Moving, "native hidden/reduced disclosure reaches semantic state at " + rate);
                }
                // 纯状态验证不实例化截图窗口，不读取屏幕或使用系统指针。
                foreach(var rate in new[]{30,60,144})
                {
                    var feedback=new CaptureMotion();feedback.Update(100,100,true,false);feedback.Update(240,180,true,false);
                    Check(Math.Abs(feedback.OffsetX)<=5&&Math.Abs(feedback.OffsetY)<=4,"capture lag bounded at "+rate);
                    for(var frame=0;frame<rate*2;frame++)feedback.Step(1d/rate);
                    Check(!feedback.Moving&&feedback.OffsetX==0&&feedback.OffsetY==0&&feedback.HandleScale==1,"capture feedback settles at "+rate);
                    feedback.Update(280,220,true,false);feedback.Update(320,250,true,true);
                    Check(!feedback.Moving&&feedback.OffsetX==0&&feedback.HandleScale==1,"capture reduced motion snaps at "+rate);
                    feedback.Update(440,320,true,false);feedback.Snap();
                    Check(!feedback.Moving&&feedback.OffsetX==0&&feedback.OffsetY==0,"handoff snaps before transfer at "+rate);
                }
                var dip=new CaptureMotion();dip.Update(300/1.5,180/1.5,true,false);dip.Update(480/1.5,300/1.5,true,false);
                Check(Math.Abs(dip.OffsetX*1.5)<=7.5&&Math.Abs(dip.OffsetY*1.5)<=6,"DPI only scales decorative offset");
                dip.Step(8);Check(double.IsFinite(dip.OffsetX)&&double.IsFinite(dip.HandleScale),"capture long frame bounded by shared solver");
                var resources=new ResourceDictionary();SoftClayTheme.Install(resources);
                var surface = new SoftClayPopupSurface { Content = new TextBlock { Text = "不缩放的正文" } };
                surface.Resources.MergedDictionaries.Add(resources); surface.Style = (Style)resources[typeof(SoftClayPopupSurface)];
                Check(surface.ApplyTemplate(), "native shared popup template loads without a window");
                var material = (FrameworkElement)surface.Template.FindName("Face", surface);
                var body = (FrameworkElement)surface.Template.FindName("Glyph", surface);
                Check(ReferenceEquals(VisualTreeHelper.GetParent(material), VisualTreeHelper.GetParent(body)), "native popup text is outside material scale");
                SoftClayMotion.EnterSurface(surface, material, body);
                Check(surface.RenderTransform.Value.IsIdentity && body.RenderTransform is TranslateTransform, "native popup keeps fixed layout and unscaled content");
                SoftClayMotion.StopSurface(surface);
                Check(material.RenderTransform.Value.IsIdentity && body.Opacity == 1, "native popup unload resets material and content");
                var expander = new Expander { Content = new TextBox { Height = 72, Text = "固定高度的合成正文" } };
                expander.Resources.MergedDictionaries.Add(resources); expander.Style = (Style)resources[typeof(Expander)];
                Check(expander.ApplyTemplate(), "native expander template loads");
                var expansion = (SoftClayDisclosure)expander.Template.FindName("Expansion", expander);
                Check(!expansion.IsEnabled && expansion.Visibility == Visibility.Collapsed, "closed disclosure immediately leaves input");
                expander.IsExpanded = true; expander.Measure(new Size(320, double.PositiveInfinity)); expander.Arrange(new Rect(expander.DesiredSize));
                Check(expansion.Progress == 1 && expansion.IsEnabled && expansion.Child!.RenderTransform.Value.IsIdentity, "unshown native disclosure resolves without scaling text or starting a window");
                expander.IsExpanded = false;
                Check(expansion.Progress == 0 && !expansion.IsEnabled && expansion.Visibility == Visibility.Collapsed, "native disclosure close releases its layout slot");
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
                    Check(control.FocusVisualStyle is null,"native focus adorners remain replaced: "+type.Name);
                    // 仅实例化模板和变换，验证固定命中层，不显示窗口或注入指针。
                    if(control is Button button)
                    {
                        var face=(FrameworkElement)button.Template.FindName("Face",button);
                        var glyph=(FrameworkElement)button.Template.FindName("Glyph",button);
                        Check(ReferenceEquals(VisualTreeHelper.GetParent(face),VisualTreeHelper.GetParent(glyph)),"native glyph is independent from deforming material");
                        SoftClayMotion.Press(button,true);
                        Check(button.RenderTransform.Value.IsIdentity&&glyph.RenderTransform is TranslateTransform,"native input slot stays fixed while glyph only translates");
                        button.RaiseEvent(new RoutedEventArgs(FrameworkElement.UnloadedEvent));
                    }
                    if(control is TextBox or PasswordBox or ComboBox)Check(control.BorderThickness==new Thickness(0),"fields have no decorative outline: "+type.Name);
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
