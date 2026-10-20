using System;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;

namespace Screenshot.App;

// 独立本地条款窗口；创建时没有WebView、捕获后端、热键、剪贴板或HTTP服务。
public partial class TermsWindow : Window
{
    private readonly TermsStartup _startup;
    private bool _documentError;
    internal TermsWindow(TermsStartup startup, bool reviewOnly = false)
    {
        _startup = startup; InitializeComponent();
        DocumentList.ItemsSource = startup.Agreement.Documents;
        DocumentList.SelectedIndex = 0;
        if (reviewOnly)
        {
            Consent.Visibility = ContinueButton.Visibility = Visibility.Collapsed;
            ExitButton.Content = "关闭"; Summary.Text = "查看当前版本的使用条款与随附第三方许可。";
        }
    }
    private void OnDocumentChanged(object sender, SelectionChangedEventArgs e)
    {
        if (DocumentList.SelectedItem is not TermsDocument document) return;
        try
        {
            var path = _startup.Agreement.Resolve(document);
            var rtf = Path.GetExtension(path).Equals(".rtf", StringComparison.OrdinalIgnoreCase);
            PlainText.Visibility = rtf ? Visibility.Collapsed : Visibility.Visible;
            RichText.Visibility = rtf ? Visibility.Visible : Visibility.Collapsed;
            if (rtf)
            {
                using var stream = File.OpenRead(path);
                new TextRange(RichText.Document.ContentStart, RichText.Document.ContentEnd).Load(stream, DataFormats.Rtf);
            }
            else PlainText.Text = File.ReadAllText(path, new UTF8Encoding(false, true));
            _documentError = false; ErrorText.Text = "";
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        { _documentError = true; ErrorText.Text = "无法显示此条款文件。请使用完整发行目录，或退出后重新校验下载。"; }
        OnConsentChanged(this, new RoutedEventArgs());
    }
    private void OnConsentChanged(object sender, RoutedEventArgs e)
    { if (ContinueButton is not null) ContinueButton.IsEnabled = Consent.IsChecked == true && !_documentError; }
    private void OnAccept(object sender, RoutedEventArgs e)
    {
        if (_documentError) { ErrorText.Text = "请先恢复可读取的完整条款文件。"; return; }
        if (!_startup.TryAccept(Consent.IsChecked == true, out var error)) { ErrorText.Text = error; return; }
        DialogResult = true;
    }
}
