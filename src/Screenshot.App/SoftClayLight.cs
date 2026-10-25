using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;

namespace Screenshot.App;

/// <summary>
/// 模板中的悬停、焦点与选中底色改为独立叠加层，由弹簧连续点亮或熄灭，不再由触发器整块换色。
/// 用法：在叠加层上写 <c>local:SoftClayLight.When="IsMouseOver&amp;!IsSelected|IsChecked"</c>，
/// 表达式按「|」取或、「&amp;」取且、「!」取反；拥有者默认是模板父级，可用 OwnerType 改为指定类型的祖先。
/// 拥有者禁用时一律熄灭。与网页 MaterialLight 一样使用近临界阻尼的 body 弹簧，并截断在 0..1。
/// </summary>
public static class SoftClayLight
{
    public static readonly DependencyProperty WhenProperty = DependencyProperty.RegisterAttached(
        "When", typeof(string), typeof(SoftClayLight), new PropertyMetadata(null, Changed));
    public static readonly DependencyProperty OwnerTypeProperty = DependencyProperty.RegisterAttached(
        "OwnerType", typeof(Type), typeof(SoftClayLight), new PropertyMetadata(null));
    public static string? GetWhen(DependencyObject target) => (string?)target.GetValue(WhenProperty);
    public static void SetWhen(DependencyObject target, string? value) => target.SetValue(WhenProperty, value);
    public static Type? GetOwnerType(DependencyObject target) => (Type?)target.GetValue(OwnerTypeProperty);
    public static void SetOwnerType(DependencyObject target, Type? value) => target.SetValue(OwnerTypeProperty, value);

    /// <summary>可用的状态名；IsCheckedAny 把三态勾选的「不确定」也视为选中。</summary>
    private static readonly Dictionary<string, DependencyProperty> States = new()
    {
        ["IsMouseOver"] = UIElement.IsMouseOverProperty,
        ["IsKeyboardFocused"] = UIElement.IsKeyboardFocusedProperty,
        ["IsKeyboardFocusWithin"] = UIElement.IsKeyboardFocusWithinProperty,
        ["IsChecked"] = ToggleButton.IsCheckedProperty,
        ["IsCheckedAny"] = ToggleButton.IsCheckedProperty,
        ["IsSelected"] = Selector.IsSelectedProperty,
        ["IsHighlighted"] = MenuItem.IsHighlightedProperty,
        ["IsDragging"] = Thumb.IsDraggingProperty,
        ["HasError"] = Validation.HasErrorProperty,
    };
    private static readonly ConditionalWeakTable<FrameworkElement, Light> Lights = new();

    private static void Changed(DependencyObject target, DependencyPropertyChangedEventArgs args)
    {
        if (target is not FrameworkElement layer || args.OldValue is not null) return;
        layer.Loaded += (_, _) => Attach(layer);
        layer.Unloaded += (_, _) => Detach(layer);
        if (layer.IsLoaded) Attach(layer);
    }

    private static void Attach(FrameworkElement layer)
    {
        if (Lights.TryGetValue(layer, out _) || GetWhen(layer) is not { Length: > 0 } when) return;
        var ownerType = GetOwnerType(layer);
        var owner = ownerType is null ? layer.TemplatedParent as UIElement : Ancestor(layer, ownerType);
        if (owner is null) return;
        var light = new Light(layer, owner, Parse(when));
        Lights.Add(layer, light);
        light.Subscribe();
    }

    private static void Detach(FrameworkElement layer)
    {
        if (!Lights.TryGetValue(layer, out var light)) return;
        light.Unsubscribe(); Lights.Remove(layer);
        SoftClayMotion.StopTimeline(layer);
    }

    private static UIElement? Ancestor(DependencyObject node, Type type)
    {
        for (var current = VisualTreeHelper.GetParent(node); current is not null; current = VisualTreeHelper.GetParent(current))
            if (type.IsInstanceOfType(current)) return current as UIElement;
        return null;
    }

    /// <summary>「|」分隔的每一项是一组「&amp;」相连的条件；未知状态名在开发时直接报错，避免静默失效。</summary>
    private static (string Name, bool Negate)[][] Parse(string expression) =>
        expression.Split('|', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Select(term => term.Split('&', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select(factor =>
            {
                var negate = factor.StartsWith('!'); var name = negate ? factor[1..] : factor;
                if (!States.ContainsKey(name)) throw new InvalidOperationException("未知的点亮状态：" + name);
                return (name, negate);
            }).ToArray()).ToArray();

    private sealed class Light(FrameworkElement layer, UIElement owner, (string Name, bool Negate)[][] terms)
    {
        private readonly SoftClayMotion.SpringState _spring = new();
        private readonly List<DependencyPropertyDescriptor> _watched = new();

        private bool State(string name)
        {
            var value = owner.GetValue(States[name]);
            return name == "IsCheckedAny" ? value is not false : value is true;
        }
        private double Target => owner.IsEnabled && terms.Any(term => term.All(factor => State(factor.Name) != factor.Negate)) ? 1 : 0;

        /// <summary>只订阅表达式用到的状态和 IsEnabled；卸载时成对移除，描述符不会延长控件寿命。</summary>
        public void Subscribe()
        {
            var properties = terms.SelectMany(term => term).Select(factor => States[factor.Name]).Append(UIElement.IsEnabledProperty).Distinct();
            foreach (var property in properties)
            {
                if (DependencyPropertyDescriptor.FromProperty(property, owner.GetType()) is not { } descriptor) continue;
                descriptor.AddValueChanged(owner, Redirect); _watched.Add(descriptor);
            }
            // 首次出现直接落在当前状态，不从熄灭补播入场。
            _spring.Snap(Target); layer.Opacity = _spring.Value;
        }
        public void Unsubscribe()
        {
            foreach (var descriptor in _watched) descriptor.RemoveValueChanged(owner, Redirect);
            _watched.Clear();
        }
        /// <summary>只改目标、保留当前亮度与速度；隐藏、未加载或系统关闭动画时直接到达终态。</summary>
        private void Redirect(object? sender, EventArgs args)
        {
            _spring.To = Target;
            SoftClayMotion.Animate(layer, elapsed =>
            {
                if (double.IsPositiveInfinity(elapsed)) _spring.Snap(_spring.To); else _spring.Step(elapsed, "body");
                layer.Opacity = Math.Clamp(_spring.Value, 0, 1);
                return _spring.Moving;
            });
        }
    }
}
