using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace Screenshot.App;

// 应用内错误和确认共用浮卡；只替换呈现，确认结果及取消默认值沿用调用方约定。
internal static class SoftClayDialog
{
    public static MessageBoxResult Show(string message, string title, MessageBoxButton buttons = MessageBoxButton.OK,
        MessageBoxImage image = MessageBoxImage.None, MessageBoxResult defaultResult = MessageBoxResult.None)
        => Show(null, message, title, buttons, image, defaultResult);

    public static MessageBoxResult Show(Window? owner, string message, string title, MessageBoxButton buttons = MessageBoxButton.OK,
        MessageBoxImage image = MessageBoxImage.None, MessageBoxResult defaultResult = MessageBoxResult.None)
    {
        // 关闭、Esc 和未指定默认值都落到安全的取消分支，不把关闭浮卡视为接受。
        var result = buttons == MessageBoxButton.OK ? MessageBoxResult.OK
            : buttons == MessageBoxButton.YesNo ? MessageBoxResult.No : MessageBoxResult.Cancel;
        if (defaultResult == MessageBoxResult.None) defaultResult = result;
        var dialog = new Window
        {
            Title = title, Width = Math.Min(520, SystemParameters.WorkArea.Width - 32),
            MaxHeight = Math.Max(240, SystemParameters.WorkArea.Height - 32), SizeToContent = SizeToContent.Height,
            WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize, AllowsTransparency = true,
            Background = Brushes.Transparent, ShowInTaskbar = false, FontFamily = SoftClayTheme.Font,
            FontSize = SoftClayTheme.Number("type", "body"), Foreground = SoftClayTheme.Brush("ink"),
            WindowStartupLocation = owner?.IsVisible == true ? WindowStartupLocation.CenterOwner : WindowStartupLocation.CenterScreen
        };
        SoftClayTheme.Install(dialog.Resources);
        if (owner?.IsVisible == true) dialog.Owner = owner;
        KeyboardNavigation.SetTabNavigation(dialog, KeyboardNavigationMode.Cycle);

        var content = new Grid { Margin = new Thickness(16) };
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        content.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
        content.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var header = new Grid { Margin = new Thickness(0, 0, 0, 16) };
        header.ColumnDefinitions.Add(new ColumnDefinition());
        header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var heading = new TextBlock { Text = title, FontSize = SoftClayTheme.Number("type", "title"), FontWeight = FontWeights.SemiBold, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap };
        heading.MouseLeftButtonDown += (_, e) => { if (e.LeftButton == MouseButtonState.Pressed) dialog.DragMove(); };
        header.Children.Add(heading);
        var close = new Button { Style = (Style)dialog.Resources["ClayCloseButton"], IsCancel = true };
        Grid.SetColumn(close, 1); header.Children.Add(close); content.Children.Add(header);
        var body = new ScrollViewer
        {
            MaxHeight = Math.Max(120, Math.Min(420, SystemParameters.WorkArea.Height - 220)),
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Content = new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap, Foreground = SoftClayTheme.Brush(image == MessageBoxImage.Error ? "error" : "muted"), LineHeight = 22 }
        };
        Grid.SetRow(body, 1); content.Children.Add(body);
        var actions = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 20, 0, 0) };
        var choices = new List<(string Label, MessageBoxResult Result)>();
        if (buttons is MessageBoxButton.YesNo or MessageBoxButton.YesNoCancel)
        {
            choices.Add(("否", MessageBoxResult.No));
            if (buttons == MessageBoxButton.YesNoCancel) choices.Add(("取消", MessageBoxResult.Cancel));
            choices.Add(("是", MessageBoxResult.Yes));
        }
        else
        {
            if (buttons == MessageBoxButton.OKCancel) choices.Add(("取消", MessageBoxResult.Cancel));
            choices.Add((buttons == MessageBoxButton.OK ? "知道了" : "确认", MessageBoxResult.OK));
        }
        Button? defaultButton = null;
        foreach (var choice in choices)
        {
            var button = new Button
            {
                Content = choice.Label, MinWidth = 80, Margin = new Thickness(8, 0, 0, 0),
                Style = (Style)dialog.Resources[choice.Result == MessageBoxResult.Yes ? "ClayDangerButton" : choice.Result == MessageBoxResult.OK ? "ClayPrimaryButton" : "ClayButton"],
                IsDefault = choice.Result == defaultResult, IsCancel = choice.Result == result
            };
            button.Click += (_, _) => { result = choice.Result; dialog.Close(); };
            if (button.IsDefault) defaultButton = button;
            actions.Children.Add(button);
        }
        Grid.SetRow(actions, 2); content.Children.Add(actions);
        dialog.Content = new SoftClayPopupSurface { Style = (Style)dialog.Resources[typeof(SoftClayPopupSurface)], Margin = new Thickness(16), Content = content };
        dialog.Loaded += (_, _) => defaultButton?.Focus();
        dialog.ShowDialog();
        return result;
    }
}
