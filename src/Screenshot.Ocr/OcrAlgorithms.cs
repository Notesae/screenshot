using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using OpenCvSharp;

namespace Screenshot.Ocr;

/// <summary>PP-OCRv5 的预处理、DB 后处理、透视裁切和 CTC 解码。</summary>
internal static class OcrAlgorithms
{
    internal const int MaxBlocks = 256;
    private const int MaxCandidates = 1000;
    private const int MaxRecognitionWidth = 2048;

    // 官方 PP-OCRv5 配置使用 BGR、ImageNet 均值/标准差及 32 的倍数输入。
    internal static ModelInput PrepareDetection(Mat image,CancellationToken token)
    {
        double ratio=Math.Min(1,960.0/Math.Max(image.Width,image.Height));
        int width=Math.Max(32,(int)Math.Round(image.Width*ratio/32)*32);
        int height=Math.Max(32,(int)Math.Round(image.Height*ratio/32)*32);
        using var resized=new Mat(); Cv2.Resize(image,resized,new Size(width,height));
        return new(Normalize(resized,width,[.485f,.456f,.406f],[.229f,.224f,.225f],token),width,height);
    }

    // 按宽高比缩放到 48 行；右侧填充归一化零值，过长单行报错而非截断内容。
    internal static ModelInput PrepareRecognition(Mat image,CancellationToken token)
    {
        int contentWidth=Math.Max(1,(int)Math.Ceiling(48.0*image.Width/image.Height));
        if(contentWidth>MaxRecognitionWidth) throw new LocalOcrException("text_line_too_long","检测到过长文字行，请缩小 OCR 选区后重试。");
        int width=Math.Max(320,contentWidth);
        using var resized=new Mat(); Cv2.Resize(image,resized,new Size(contentWidth,48));
        return new(Normalize(resized,width,[.5f,.5f,.5f],[.5f,.5f,.5f],token),width,48);
    }

    // 将 BGR 像素写为 NCHW 数组，逐行观察取消，填充区保持全零。
    private static unsafe float[] Normalize(Mat image,int paddedWidth,float[] mean,float[] std,CancellationToken token)
    {
        int height=image.Height, width=image.Width;
        int plane=paddedWidth*height;
        var result=new float[3*plane];
        for(int y=0;y<height;y++)
        {
            token.ThrowIfCancellationRequested(); var row=(byte*)image.Ptr(y);
            for(int x=0;x<width;x++) for(int channel=0;channel<3;channel++)
                result[channel*plane+y*paddedWidth+x]=(row[x*3+channel]/255f-mean[channel])/std[channel];
        }
        return result;
    }

    // DB：像素阈值→轮廓→最小面积矩形→区域均分→等距扩张→源像素坐标。
    internal static IReadOnlyList<DetectedBox> ExtractBoxes(float[] probability,int mapWidth,int mapHeight,int imageWidth,int imageHeight,CancellationToken token)
    {
        if(mapWidth<=0 || mapHeight<=0 || probability.Length!=(long)mapWidth*mapHeight)
            throw new LocalOcrException("model_invalid","检测模型输出尺寸无效。");
        using var map=Mat.FromPixelData(mapHeight,mapWidth,MatType.CV_32FC1,probability);
        using var threshold=new Mat(); using var binary=new Mat();
        Cv2.Threshold(map,threshold,.3,255,ThresholdTypes.Binary); threshold.ConvertTo(binary,MatType.CV_8UC1);
        Cv2.FindContours(binary,out Point[][] contours,out _,RetrievalModes.List,ContourApproximationModes.ApproxSimple);
        if(contours.Length>MaxCandidates) throw new LocalOcrException("too_many_blocks","文字候选区域过多，请缩小 OCR 选区。");
        var boxes=new List<DetectedBox>();
        foreach(var contour in contours)
        {
            token.ThrowIfCancellationRequested();
            if(contour.Length<3 || Cv2.ContourArea(contour)<9) continue;
            var rectangle=Cv2.MinAreaRect(contour);
            if(Math.Min(rectangle.Size.Width,rectangle.Size.Height)<3) continue;
            var points=rectangle.Points();
            int left=Math.Clamp((int)Math.Floor(points.Min(p=>p.X)),0,mapWidth-1);
            int top=Math.Clamp((int)Math.Floor(points.Min(p=>p.Y)),0,mapHeight-1);
            int right=Math.Clamp((int)Math.Ceiling(points.Max(p=>p.X)),left,mapWidth-1);
            int bottom=Math.Clamp((int)Math.Ceiling(points.Max(p=>p.Y)),top,mapHeight-1);
            using var mask=new Mat(bottom-top+1,right-left+1,MatType.CV_8UC1,Scalar.Black);
            Cv2.FillConvexPoly(mask,points.Select(p=>new Point((int)Math.Round(p.X)-left,(int)Math.Round(p.Y)-top)).ToArray(),Scalar.White);
            using var region=new Mat(map,new Rect(left,top,mask.Width,mask.Height));
            double score=Cv2.Mean(region,mask).Val0;
            if(!double.IsFinite(score) || score<.6) continue;
            // 最小面积矩形按 area*1.5/perimeter 扩张，等价于圆角偏移后的外接矩形。
            double distance=rectangle.Size.Width*rectangle.Size.Height*1.5/(2*(rectangle.Size.Width+rectangle.Size.Height));
            var expanded=new RotatedRect(rectangle.Center,new Size2f((float)(rectangle.Size.Width+2*distance),(float)(rectangle.Size.Height+2*distance)),rectangle.Angle);
            var ordered=OrderQuad(expanded.Points()).Select(p=>new OcrPoint(
                Math.Clamp((double)p.X*imageWidth/mapWidth,0,imageWidth-1),Math.Clamp((double)p.Y*imageHeight/mapHeight,0,imageHeight-1))).ToArray();
            if(Distance(ordered[0],ordered[1])<=3 || Distance(ordered[0],ordered[3])<=3) continue;
            boxes.Add(new(ordered,score));
            if(boxes.Count>MaxBlocks) throw new LocalOcrException("too_many_blocks","检测到超过 256 个文字块，请缩小 OCR 选区。");
        }
        return SortReadingOrder(boxes);
    }

    // 固定左上、右上、右下、左下顺序，供透视变换与公开多边形共用。
    private static Point2f[] OrderQuad(Point2f[] points)
    {
        var sorted=points.OrderBy(p=>p.X).ThenBy(p=>p.Y).ToArray();
        var left=sorted.Take(2).OrderBy(p=>p.Y).ToArray(); var right=sorted.Skip(2).OrderBy(p=>p.Y).ToArray();
        return [left[0],right[0],right[1],left[1]];
    }

    // 透视校正源图裁片，明显竖向时逆时针旋转；未添加 180° 方向分类器。
    internal static Mat Rectify(Mat source,IReadOnlyList<OcrPoint> polygon)
    {
        int width=Math.Max(1,(int)Math.Round(Math.Max(Distance(polygon[0],polygon[1]),Distance(polygon[2],polygon[3]))));
        int height=Math.Max(1,(int)Math.Round(Math.Max(Distance(polygon[0],polygon[3]),Distance(polygon[1],polygon[2]))));
        if((long)width*height>PngInput.MaxPixels) throw new LocalOcrException("image_too_large","文字裁片尺寸超过本地 OCR 限制。");
        var input=polygon.Select(p=>new Point2f((float)p.X,(float)p.Y)).ToArray();
        Point2f[] target=[new(0,0),new(width-1,0),new(width-1,height-1),new(0,height-1)];
        using var transform=Cv2.GetPerspectiveTransform(input,target);
        var result=new Mat();
        try
        {
            Cv2.WarpPerspective(source,result,transform,new Size(width,height),InterpolationFlags.Cubic,BorderTypes.Replicate);
            if(height>=width*1.5)
            {
                var rotated=new Mat(); Cv2.Rotate(result,rotated,RotateFlags.Rotate90Counterclockwise); result.Dispose(); result=rotated;
            }
            return result;
        }
        catch { result.Dispose(); throw; }
    }

    // 贪心 CTC 仅去掉相邻重复与索引零，平均原始保留字符概率，不改写低分文字。
    internal static DecodedText DecodeCtc(float[] scores,int steps,int classes,IReadOnlyList<string> dictionary,CancellationToken token)
    {
        if(steps<=0 || classes!=dictionary.Count || scores.Length!=(long)steps*classes)
            throw new LocalOcrException("model_invalid","识别模型输出与字符字典不一致。");
        var text=new StringBuilder(); double confidence=0; int retained=0; int previous=-1;
        for(int step=0;step<steps;step++)
        {
            token.ThrowIfCancellationRequested(); int offset=step*classes; int selected=0; float maximum=scores[offset];
            for(int c=1;c<classes;c++) if(scores[offset+c]>maximum) { maximum=scores[offset+c]; selected=c; }
            if(!float.IsFinite(maximum) || maximum<0 || maximum>1.00001f) throw new LocalOcrException("model_invalid","识别模型返回了无效概率。");
            if(selected!=0 && selected!=previous) { text.Append(dictionary[selected]); confidence+=maximum; retained++; }
            previous=selected;
        }
        return new(text.ToString(),retained==0?0:confidence/retained);
    }

    // 聚合近似同一行，再从上到下、行内从左到右排序，不推断复杂多栏语义。
    internal static IReadOnlyList<DetectedBox> SortReadingOrder(IEnumerable<DetectedBox> boxes)
    {
        var lines=new List<List<DetectedBox>>();
        foreach(var box in boxes.OrderBy(b=>b.Polygon.Average(p=>p.Y)).ThenBy(b=>b.Polygon.Min(p=>p.X)))
        {
            double center=box.Polygon.Average(p=>p.Y); double height=box.Polygon.Max(p=>p.Y)-box.Polygon.Min(p=>p.Y);
            var line=lines.LastOrDefault(l=>Math.Abs(center-l.Average(b=>b.Polygon.Average(p=>p.Y)))<=Math.Max(4,height*.5));
            if(line is null) lines.Add([box]); else line.Add(box);
        }
        return lines.SelectMany(line=>line.OrderBy(b=>b.Polygon.Min(p=>p.X))).ToArray();
    }

    // 标识依赖图片摘要、四分之一像素量化框和阅读序号，不含识别文本。
    internal static string CreateBlockId(byte[] imageHash,IReadOnlyList<OcrPoint> polygon,int order)
    {
        var bytes=new byte[imageHash.Length+4+polygon.Count*8]; imageHash.CopyTo(bytes,0);
        BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(imageHash.Length),order);
        for(int i=0;i<polygon.Count;i++)
        {
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(imageHash.Length+4+i*8),(int)Math.Round(polygon[i].X*4));
            BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(imageHash.Length+8+i*8),(int)Math.Round(polygon[i].Y*4));
        }
        return "ocr-"+Convert.ToHexString(SHA256.HashData(bytes).AsSpan(0,16)).ToLowerInvariant();
    }

    private static double Distance(OcrPoint a,OcrPoint b)=>Math.Sqrt((a.X-b.X)*(a.X-b.X)+(a.Y-b.Y)*(a.Y-b.Y));
}
