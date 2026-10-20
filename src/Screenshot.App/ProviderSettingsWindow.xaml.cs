using Screenshot.AI;
using System;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;

namespace Screenshot.App;

/// <summary>原生服务商设置窗口，编辑密钥时不会向前端或网络发送配置。</summary>
public partial class ProviderSettingsWindow : Window
{
    private readonly AiService _service;
    private string? _selectedId;
    private string? _defaultId;
    // 重绑列表时忽略选择事件，避免把正在恢复的表单覆盖。
    private bool _refreshing;

    /// <summary>初始化原生控件，在窗口加载后读取公开配置。</summary>
    public ProviderSettingsWindow(AiService service, Func<Task<bool>>? saveBeforeUpdate = null)
    {
        InitializeComponent();
        _service = service;
        var updates = new UpdateSettingsControl { SaveBeforeExit = saveBeforeUpdate };
        UpdateTab.Content = updates;
        Closed += (_, _) => updates.Dispose();
        Loaded += async (_, _) => await ReloadAsync();
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
            _refreshing = false;
            if (ProviderList.SelectedItem is PublicProvider provider) Fill(provider);
            else NewProvider("openai-compatible");
        }
        catch (AiProviderException e) { Status.Text = e.Message; }
        catch { Status.Text = "无法读取服务商设置，请检查本地文件权限。"; }
        finally { _refreshing = false; }
    }

    private void ProviderList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!_refreshing && ProviderList.SelectedItem is PublicProvider provider) Fill(provider);
    }

    // 展示公开配置，清空密码输入但保留已存密钥的状态提示。
    private void Fill(PublicProvider provider)
    {
        _selectedId = provider.Id;
        ProviderName.Text = provider.Name;
        ProviderKind.SelectedIndex = provider.Kind == "ollama" ? 1 : 0;
        ProviderBaseUrl.Text = provider.BaseUrl;
        ProviderModel.Text = provider.Model;
        ApiKey.Clear();
        ClearKey.IsChecked = false;
        MakeDefault.IsChecked = provider.Id == _defaultId;
        KeyState.Text = provider.HasApiKey ? "已安全保存密钥。留空会保留原密钥；填写新密钥会替换。" : "尚未保存密钥。Ollama 本机服务通常可留空。";
        DeleteButton.IsEnabled = true;
        Status.Text = "";
    }

    // 为所选协议准备新建表单，不保存配置、不检测网络或模型。
    private void NewProvider(string kind)
    {
        _selectedId = null;
        ProviderList.SelectedItem = null;
        ProviderName.Text = kind == "ollama" ? "Ollama 本机" : "OpenAI 兼容服务";
        ProviderKind.SelectedIndex = kind == "ollama" ? 1 : 0;
        ProviderBaseUrl.Text = kind == "ollama" ? "http://localhost:11434" : "";
        ProviderModel.Clear();
        ApiKey.Clear();
        ClearKey.IsChecked = false;
        MakeDefault.IsChecked = _defaultId is null;
        KeyState.Text = "密钥使用当前 Windows 账户加密，仅原生宿主可读取。";
        DeleteButton.IsEnabled = false;
        Status.Text = "请填写服务地址和实际可用的模型名称。";
        ProviderName.Focus();
    }

    private void AddOpenAi_Click(object sender, RoutedEventArgs e) => NewProvider("openai-compatible");
    private void AddOllama_Click(object sender, RoutedEventArgs e) => NewProvider("ollama");

    // 将用户明确的保存/清除操作交给原生服务，等待期间禁止重复编辑。
    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        if (ClearKey.IsChecked == true && ApiKey.Password.Length != 0)
        {
            Status.Text = "请选择填写新密钥或清除原密钥，不能同时执行。";
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
            Status.Text = "已保存。未发送网络请求；可在编辑器中明确点击 OCR 或翻译使用。";
        }
        catch (AiProviderException error) { Status.Text = error.Message; }
        catch { Status.Text = "保存失败，请检查本地配置权限后重试。"; }
        finally { SettingsForm.IsEnabled = true; }
    }

    // 明确确认删除服务和密钥后刷新列表，并显示可读的本地错误。
    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedId is null || MessageBox.Show(this, "删除该服务商及其已保存密钥？", "删除服务商", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        SettingsForm.IsEnabled = false;
        try
        {
            await _service.DeleteProviderAsync(_selectedId);
            await ReloadAsync();
            Status.Text = "服务商已删除。";
        }
        catch (AiProviderException error) { Status.Text = error.Message; }
        catch { Status.Text = "删除失败，请检查本地配置权限后重试。"; }
        finally { SettingsForm.IsEnabled = true; }
    }
}
