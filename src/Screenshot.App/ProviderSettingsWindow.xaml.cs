using Screenshot.AI;
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Text.Json;
using System.Threading;
using Screenshot.App.Updates;

namespace Screenshot.App;

/// <summary>原生服务商设置窗口，编辑密钥时不会向前端或网络发送配置。</summary>
public partial class ProviderSettingsWindow : Window
{
    private readonly AiService _service;
    private string? _selectedId;
    private string? _defaultId;
    // 重绑列表时忽略选择事件，避免把正在恢复的表单覆盖。
    private bool _refreshing;
    // 设置页只调用宿主已有的截图配置命令，服务密钥不经过编辑器。
    private readonly Func<string, JsonElement, Task<object?>>? _executeSettings;
    private readonly Action<Window>? _showTerms;
    // 只记录密钥是否存在；不读取、显示或缓存已保存的密钥正文。
    private bool _hasStoredKey, _settingsClosed;
    private CancellationTokenSource? _connectionTest;

    /// <summary>初始化原生控件，在窗口加载后读取公开配置。</summary>
    internal ProviderSettingsWindow(AiService service, Func<Task<bool>>? saveBeforeUpdate,
        Func<string, JsonElement, Task<object?>>? executeSettings = null, Action<Window>? showTerms = null, string section = "capture")
    {
        InitializeComponent();
        _service = service;
        _executeSettings = executeSettings;
        _showTerms = showTerms;
        CaptureTab.Visibility = executeSettings is null ? Visibility.Collapsed : Visibility.Visible;
        TermsButton.Visibility = showTerms is null ? Visibility.Collapsed : Visibility.Visible;
        SettingsTabs.SelectedItem = section == "updates" ? UpdateTab : section == "services" || executeSettings is null ? ServicesTab : CaptureTab;
        HotkeyKey.ItemsSource = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".Select(key => key.ToString()).Concat(Enumerable.Range(1, 11).Select(key => "F" + key));
        var updates = new UpdateSettingsControl() { SaveBeforeExit = saveBeforeUpdate };
        UpdateTab.Content = updates;
        Closing += (_, e) => { if (!updates.RequestClose()) e.Cancel = true; };
        Closed += (_, _) => { _settingsClosed = true; _connectionTest?.Cancel(); updates.Dispose(); };
        ProviderBaseUrl.TextChanged += ConnectionEdited;
        ProviderModel.TextChanged += ConnectionEdited;
        ProviderName.TextChanged += ConnectionEdited;
        ProviderKind.SelectionChanged += ConnectionEdited;
        ApiKey.PasswordChanged += ConnectionEdited;
        ClearKey.Checked += ConnectionEdited;
        ClearKey.Unchecked += ConnectionEdited;
        // 小工作区中只缩短可滚动内容，标题和保存操作保持在浮卡内部。
        Loaded += async (_, _) =>
        {
            MaxHeight = Math.Max(MinHeight, SystemParameters.WorkArea.Height - 16);
            Height = Math.Min(Height, MaxHeight);
            await ReloadAsync();
            if (_executeSettings is not null) await LoadCapturePreferencesAsync();
        };
    }

    private void Terms_Click(object sender, RoutedEventArgs e) => _showTerms?.Invoke(this);

    // 字段一经修改，旧的测试成功不再代表当前草稿；输入框占位仅展示密钥保存状态。
    private void ConnectionEdited(object sender, RoutedEventArgs e)
    {
        KeyBadge.Text = ClearKey.IsChecked == true ? "待删除" : ApiKey.Password.Length > 0 ? "新密钥 · 尚未保存" : _hasStoredKey ? "✓ 已保存" : "未保存";
        KeyPlaceholder.Text = _hasStoredKey ? "••••••••  已保存，留空继续使用" : "填写 API 密钥";
        KeyPlaceholder.Visibility = ApiKey.Password.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
        SetStatus("");
    }

    // 测试当前草稿而非后台旧配置；只发送固定文字，不保存、不截图，并可取消或随窗口关闭终止。
    private async void TestConnection_Click(object sender, RoutedEventArgs e)
    {
        if (_connectionTest is not null) return;
        if (string.IsNullOrWhiteSpace(ProviderBaseUrl.Text) || string.IsNullOrWhiteSpace(ProviderModel.Text))
        {
            SetStatus("请填写服务地址和模型名称后再测试。", true);
            return;
        }
        if (ClearKey.IsChecked == true && ApiKey.Password.Length > 0)
        {
            MoreSettings.IsExpanded = true;
            SetStatus("填写新密钥时，请取消“删除已保存的密钥”。", true);
            return;
        }
        using var cancellation = new CancellationTokenSource();
        _connectionTest = cancellation;
        ProviderSidebar.IsEnabled = ProviderScroll.IsEnabled = SaveButton.IsEnabled = DeleteButton.IsEnabled = TestConnectionButton.IsEnabled = false;
        CancelConnectionTestButton.Visibility = Visibility.Visible;
        TestConnectionButton.Content = "测试中…";
        SetStatus("正在测试当前配置…");
        try
        {
            var draft = new ProviderUpdate(_selectedId ?? "connection-draft", ProviderName.Text,
                ProviderKind.SelectedIndex == 1 ? "ollama" : "openai-compatible", ProviderBaseUrl.Text, ProviderModel.Text,
                ApiKey.Password.Length == 0 ? null : ApiKey.Password, ClearKey.IsChecked == true, MakeDefault.IsChecked == true);
            await _service.ProbeDraftAsync(draft, cancellation.Token);
            cancellation.Token.ThrowIfCancellationRequested();
            if (!_settingsClosed)
            {
                SetStatus("文字翻译请求成功。");
            }
        }
        catch (Exception error)
        {
            if (!_settingsClosed)
            {
                var cancelled = cancellation.IsCancellationRequested;
                SetStatus(cancelled ? "测试已取消。" : "连接失败：" + (error is AiProviderException ? error.Message : "请检查服务地址和网络后重试。"), !cancelled);
            }
        }
        finally
        {
            _connectionTest = null;
            if (!_settingsClosed)
            {
                ProviderSidebar.IsEnabled = ProviderScroll.IsEnabled = SaveButton.IsEnabled = DeleteButton.IsEnabled = TestConnectionButton.IsEnabled = true;
                CancelConnectionTestButton.Visibility = Visibility.Collapsed;
                TestConnectionButton.Content = "测试连接";
            }
        }
    }

    private void CancelConnectionTest_Click(object sender, RoutedEventArgs e) => _connectionTest?.Cancel();

    // 进入统一设置时读取现有配置；不枚举显示器、不截图，也不重新注册热键。
    private async Task LoadCapturePreferencesAsync()
    {
        try
        {
            var capture = JsonSerializer.SerializeToElement(await _executeSettings!("capture.settings", default));
            CaptureBackend.SelectedIndex = capture.GetProperty("backend").GetString() == "gdi" ? 1 : 0;
            SnapWindows.IsChecked = capture.GetProperty("snapWindows").GetBoolean();
            SnapArea.SelectedIndex = capture.GetProperty("windowArea").GetString() == "client" ? 1 : 0;
            var hotkey = (HotkeyStatus)(await _executeSettings("hotkey.read", default))!;
            HotkeyEnabled.IsChecked = hotkey.Binding.Enabled;
            HotkeyCtrl.IsChecked = hotkey.Binding.Ctrl;
            HotkeyAlt.IsChecked = hotkey.Binding.Alt;
            HotkeyShift.IsChecked = hotkey.Binding.Shift;
            HotkeyKey.SelectedItem = hotkey.Binding.Key;
            HotkeyMessage.Text = hotkey.Message;
        }
        catch (Exception error) { CapturePreferences.IsEnabled = false; SetCaptureStatus("无法读取截图设置：" + error.Message, true); }
    }

    // 截图配置与热键分别提交，热键冲突不会造成其他设置保存结果含糊。
    private async void ApplyCapture_Click(object sender, RoutedEventArgs e)
    {
        CapturePreferences.IsEnabled = false;
        try
        {
            var payload = JsonSerializer.SerializeToElement(new { backend = CaptureBackend.SelectedIndex == 1 ? "gdi" : "wgc", snapWindows = SnapWindows.IsChecked == true, windowArea = SnapArea.SelectedIndex == 1 ? "client" : "window" });
            await _executeSettings!("capture.configure", payload);
            SetCaptureStatus("截图设置已应用。");
        }
        catch (Exception error) { SetCaptureStatus(error.Message, true); }
        finally { CapturePreferences.IsEnabled = true; }
    }

    // 只有用户点击应用才注册组合键，冲突仍由宿主保留原来的有效组合。
    private async void ApplyHotkey_Click(object sender, RoutedEventArgs e)
    {
        CapturePreferences.IsEnabled = false;
        try
        {
            var payload = JsonSerializer.SerializeToElement(new { enabled = HotkeyEnabled.IsChecked == true, ctrl = HotkeyCtrl.IsChecked == true, alt = HotkeyAlt.IsChecked == true, shift = HotkeyShift.IsChecked == true, key = HotkeyKey.SelectedItem as string ?? "S" });
            var result = (HotkeyStatus)(await _executeSettings!("hotkey.configure", payload))!;
            HotkeyMessage.Text = result.Message;
            SetCaptureStatus(result.Applied ? "快捷键已应用。" : result.Message, !result.Applied);
        }
        catch (Exception error) { SetCaptureStatus(error.Message, true); }
        finally { CapturePreferences.IsEnabled = true; }
    }

    // 自绘标题保留直接拖动；关闭按钮独立于拖动区域，不钳制用户落点。
    private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ChangedButton == MouseButton.Left) { DragMove(); e.Handled = true; }
    }

    // 刷新服务摘要并保留指定选择；没有服务时准备新建表单。
    private async Task ReloadAsync(string? selectId = null)
    {
        try
        {
            var settings = await _service.ReadSettingsAsync();
            _defaultId = settings.DefaultProviderId;
            _refreshing = true;
            ProviderList.ItemsSource = settings.Providers;
            ProviderList.SelectedItem = settings.Providers.FirstOrDefault(p => p.Id == selectId) ?? settings.Providers.FirstOrDefault();
            // 首次配置直接展示完整表单，有已保存服务后才为侧栏预留空间。
            var hasProviders = settings.Providers.Any();
            ProviderSidebar.Visibility = hasProviders ? Visibility.Visible : Visibility.Collapsed;
            ProviderSidebarColumn.Width = new GridLength(hasProviders ? 176 : 0);
            _refreshing = false;
            if (ProviderList.SelectedItem is PublicProvider provider) Fill(provider);
            else NewProvider("openai-compatible");
        }
        catch (AiProviderException e) { SetStatus(e.Message, true); }
        catch { SetStatus("无法读取服务设置，请稍后重试。", true); }
        finally { _refreshing = false; }
    }

    private void ProviderList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_refreshing && ProviderList.SelectedItem is PublicProvider provider) Fill(provider);
    }

    // 展示公开配置，清空密码输入但保留已存密钥的状态提示。
    private void Fill(PublicProvider provider)
    {
        _hasStoredKey = provider.HasApiKey;
        _selectedId = provider.Id;
        FormTitle.Text = provider.Name;
        ProviderName.Text = provider.Name;
        ProviderKind.SelectedIndex = provider.Kind == "ollama" ? 1 : 0;
        ProviderBaseUrl.Text = provider.BaseUrl;
        ProviderModel.Text = provider.Model;
        ApiKey.Clear();
        ClearKey.IsChecked = false;
        MakeDefault.IsChecked = provider.Id == _defaultId;
        KeyState.Text = provider.HasApiKey ? "已保存密钥。留空保留，填写新密钥即可替换。" : "填写服务商提供的密钥；Ollama 本地服务通常可留空。";
        ClearKey.Visibility = provider.HasApiKey ? Visibility.Visible : Visibility.Collapsed;
        DeleteButton.Visibility = Visibility.Visible;
        SaveButton.Content = "保存修改";
        MoreSettings.IsExpanded = false;
        ProviderScroll.ScrollToTop();
        ConnectionEdited(this, new RoutedEventArgs());
        SetStatus("");
    }

    // 为所选协议准备新建表单，不保存配置、不检测网络或模型。
    private void NewProvider(string kind)
    {
        _hasStoredKey = false;
        _selectedId = null;
        ProviderList.SelectedItem = null;
        FormTitle.Text = "连接 AI 服务";
        ProviderName.Text = kind == "ollama" ? "Ollama 本机" : "OpenAI 兼容服务";
        ProviderKind.SelectedIndex = kind == "ollama" ? 1 : 0;
        ProviderBaseUrl.Text = kind == "ollama" ? "http://localhost:11434" : "";
        ProviderModel.Clear();
        ApiKey.Clear();
        ClearKey.IsChecked = false;
        MakeDefault.IsChecked = _defaultId is null;
        KeyState.Text = "填写服务商提供的密钥；Ollama 本地服务通常可留空。";
        ClearKey.Visibility = Visibility.Collapsed;
        DeleteButton.Visibility = Visibility.Collapsed;
        SaveButton.Content = "保存连接";
        MoreSettings.IsExpanded = false;
        ProviderScroll.ScrollToTop();
        ConnectionEdited(this, new RoutedEventArgs());
        SetStatus("");
    }

    private void AddOpenAi_Click(object sender, RoutedEventArgs e) => NewProvider("openai-compatible");

    // 保存和测试共用表单内反馈，不在窗口底部同时堆积两条状态。
    private void SetStatus(string text, bool error = false)
    {
        ConnectionTestResult.Text = text;
        ConnectionTestResult.Foreground = error ? SoftClayTheme.Brush("error") : SoftClayTheme.Brush("muted");
    }

    // 截图页的结果留在所属页面，避免与服务连接的保存/测试消息混在一起。
    private void SetCaptureStatus(string text, bool error = false)
    {
        CaptureStatus.Text = text;
        CaptureStatus.Foreground = error ? SoftClayTheme.Brush("error") : SoftClayTheme.Brush("muted");
    }

    // 将用户明确的保存/清除操作交给原生服务，等待期间禁止重复编辑。
    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (ClearKey.IsChecked == true && ApiKey.Password.Length != 0)
        {
            MoreSettings.IsExpanded = true;
            SetStatus("填写新密钥时，请取消“删除已保存的密钥”。", true);
            return;
        }
        // 在用户保存时定位缺失项，避免一进页面就报错或让折叠项中的错误无法找到。
        if (string.IsNullOrWhiteSpace(ProviderBaseUrl.Text))
        {
            SetStatus("请填写服务地址。", true);
            ProviderBaseUrl.Focus();
            return;
        }
        if (string.IsNullOrWhiteSpace(ProviderModel.Text))
        {
            SetStatus("请填写模型名称，可在服务商的模型列表中查找。", true);
            ProviderModel.Focus();
            return;
        }
        if (string.IsNullOrWhiteSpace(ProviderName.Text))
        {
            MoreSettings.IsExpanded = true;
            SetStatus("请为这个连接填写显示名称。", true);
            ProviderName.Focus();
            return;
        }
        SettingsForm.IsEnabled = false;
        try
        {
            var id = _selectedId ?? Guid.NewGuid().ToString("N");
            var kind = (ProviderKind.SelectedItem as ComboBoxItem)?.Tag?.ToString() ?? "openai-compatible";
            await _service.UpdateProviderAsync(new(id, ProviderName.Text, kind, ProviderBaseUrl.Text, ProviderModel.Text,
                ApiKey.Password.Length == 0 ? null : ApiKey.Password, ClearKey.IsChecked == true, MakeDefault.IsChecked == true));
            ApiKey.Clear();
            await ReloadAsync(id);
            SetStatus("配置已保存，点击“测试连接”确认是否可用。");
        }
        catch (AiProviderException error) { SetStatus(error.Message, true); }
        catch { SetStatus("保存失败，请稍后重试。", true); }
        finally { SettingsForm.IsEnabled = true; }
    }

    // 明确确认删除服务和密钥后刷新列表，并显示可读的本地错误。
    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedId is null || SoftClayDialog.Show(this, "删除这个连接及其已保存的密钥？", "删除连接", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        SettingsForm.IsEnabled = false;
        try
        {
            await _service.DeleteProviderAsync(_selectedId);
            await ReloadAsync();
            SetStatus("连接已删除。");
        }
        catch (AiProviderException error) { SetStatus(error.Message, true); }
        catch { SetStatus("删除失败，请稍后重试。", true); }
        finally { SettingsForm.IsEnabled = true; }
    }
}
