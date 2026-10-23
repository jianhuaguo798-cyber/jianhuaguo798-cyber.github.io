// macOS Vision「主体提取」→ 灰度蒙版 PNG（JXA，免编译）
// 用法: osascript -l JavaScript tools/cutout.js <输入图> <输出蒙版.png>
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('Vision');
ObjC.import('CoreImage');

function run(argv) {
  const inPath = argv[0], outPath = argv[1];
  const url = $.NSURL.fileURLWithPath(inPath);
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $({}));
  const req = $.VNGenerateForegroundInstanceMaskRequest.alloc.init;
  const err = Ref();
  const ok = handler.performRequestsError($([req]), err);
  if (!ok) return 'perform failed';
  const results = req.results;
  if (!results || results.count === 0) return 'no subject';
  const obs = results.objectAtIndex(0);
  const inst = obs.allInstances;
  const buf = obs.generateScaledMaskForImageForInstancesFromRequestHandlerError(inst, handler, err);
  const ci = $.CIImage.imageWithCVPixelBuffer(buf);
  const ctx = $.CIContext.contextWithOptions($({}));
  const cs = $.CGColorSpaceCreateDeviceGray();
  const dst = $.NSURL.fileURLWithPath(outPath);
  // kCIFormatL8
  const fmt = $.kCIFormatL8;
  const wrote = ctx.writePNGRepresentationOfImageToURLFormatColorSpaceOptionsError(ci, dst, fmt, cs, $({}), err);
  return 'instances=' + inst.count + ' wrote=' + wrote + ' ext=' + JSON.stringify([ci.extent.size.width, ci.extent.size.height]);
}
