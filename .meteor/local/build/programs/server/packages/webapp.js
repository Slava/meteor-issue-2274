(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var Log = Package.logging.Log;
var _ = Package.underscore._;
var RoutePolicy = Package.routepolicy.RoutePolicy;
var HTML = Package.htmljs.HTML;
var UI = Package.ui.UI;
var Handlebars = Package.ui.Handlebars;
var Spacebars = Package['spacebars-common'].Spacebars;
var HTMLTools = Package['html-tools'].HTMLTools;

/* Package-scope variables */
var WebApp, main, WebAppInternals;

(function () {

///////////////////////////////////////////////////////////////////////////////////////////
//                                                                                       //
// packages/webapp/webapp_server.js                                                      //
//                                                                                       //
///////////////////////////////////////////////////////////////////////////////////////////
                                                                                         //
////////// Requires //////////                                                           // 1
                                                                                         // 2
var fs = Npm.require("fs");                                                              // 3
var http = Npm.require("http");                                                          // 4
var os = Npm.require("os");                                                              // 5
var path = Npm.require("path");                                                          // 6
var url = Npm.require("url");                                                            // 7
var crypto = Npm.require("crypto");                                                      // 8
                                                                                         // 9
var connect = Npm.require('connect');                                                    // 10
var useragent = Npm.require('useragent');                                                // 11
var send = Npm.require('send');                                                          // 12
                                                                                         // 13
var SHORT_SOCKET_TIMEOUT = 5*1000;                                                       // 14
var LONG_SOCKET_TIMEOUT = 120*1000;                                                      // 15
                                                                                         // 16
WebApp = {};                                                                             // 17
WebAppInternals = {};                                                                    // 18
                                                                                         // 19
var bundledJsCssPrefix;                                                                  // 20
                                                                                         // 21
// Keepalives so that when the outer server dies unceremoniously and                     // 22
// doesn't kill us, we quit ourselves. A little gross, but better than                   // 23
// pidfiles.                                                                             // 24
// XXX This should really be part of the boot script, not the webapp package.            // 25
//     Or we should just get rid of it, and rely on containerization.                    // 26
                                                                                         // 27
var initKeepalive = function () {                                                        // 28
  var keepaliveCount = 0;                                                                // 29
                                                                                         // 30
  process.stdin.on('data', function (data) {                                             // 31
    keepaliveCount = 0;                                                                  // 32
  });                                                                                    // 33
                                                                                         // 34
  process.stdin.resume();                                                                // 35
                                                                                         // 36
  setInterval(function () {                                                              // 37
    keepaliveCount ++;                                                                   // 38
    if (keepaliveCount >= 3) {                                                           // 39
      console.log("Failed to receive keepalive! Exiting.");                              // 40
      process.exit(1);                                                                   // 41
    }                                                                                    // 42
  }, 3000);                                                                              // 43
};                                                                                       // 44
                                                                                         // 45
                                                                                         // 46
var sha1 = function (contents) {                                                         // 47
  var hash = crypto.createHash('sha1');                                                  // 48
  hash.update(contents);                                                                 // 49
  return hash.digest('hex');                                                             // 50
};                                                                                       // 51
                                                                                         // 52
// #BrowserIdentification                                                                // 53
//                                                                                       // 54
// We have multiple places that want to identify the browser: the                        // 55
// unsupported browser page, the appcache package, and, eventually                       // 56
// delivering browser polyfills only as needed.                                          // 57
//                                                                                       // 58
// To avoid detecting the browser in multiple places ad-hoc, we create a                 // 59
// Meteor "browser" object. It uses but does not expose the npm                          // 60
// useragent module (we could choose a different mechanism to identify                   // 61
// the browser in the future if we wanted to).  The browser object                       // 62
// contains                                                                              // 63
//                                                                                       // 64
// * `name`: the name of the browser in camel case                                       // 65
// * `major`, `minor`, `patch`: integers describing the browser version                  // 66
//                                                                                       // 67
// Also here is an early version of a Meteor `request` object, intended                  // 68
// to be a high-level description of the request without exposing                        // 69
// details of connect's low-level `req`.  Currently it contains:                         // 70
//                                                                                       // 71
// * `browser`: browser identification object described above                            // 72
// * `url`: parsed url, including parsed query params                                    // 73
//                                                                                       // 74
// As a temporary hack there is a `categorizeRequest` function on WebApp which           // 75
// converts a connect `req` to a Meteor `request`. This can go away once smart           // 76
// packages such as appcache are being passed a `request` object directly when           // 77
// they serve content.                                                                   // 78
//                                                                                       // 79
// This allows `request` to be used uniformly: it is passed to the html                  // 80
// attributes hook, and the appcache package can use it when deciding                    // 81
// whether to generate a 404 for the manifest.                                           // 82
//                                                                                       // 83
// Real routing / server side rendering will probably refactor this                      // 84
// heavily.                                                                              // 85
                                                                                         // 86
                                                                                         // 87
// e.g. "Mobile Safari" => "mobileSafari"                                                // 88
var camelCase = function (name) {                                                        // 89
  var parts = name.split(' ');                                                           // 90
  parts[0] = parts[0].toLowerCase();                                                     // 91
  for (var i = 1;  i < parts.length;  ++i) {                                             // 92
    parts[i] = parts[i].charAt(0).toUpperCase() + parts[i].substr(1);                    // 93
  }                                                                                      // 94
  return parts.join('');                                                                 // 95
};                                                                                       // 96
                                                                                         // 97
var identifyBrowser = function (userAgentString) {                                       // 98
  var userAgent = useragent.lookup(userAgentString);                                     // 99
  return {                                                                               // 100
    name: camelCase(userAgent.family),                                                   // 101
    major: +userAgent.major,                                                             // 102
    minor: +userAgent.minor,                                                             // 103
    patch: +userAgent.patch                                                              // 104
  };                                                                                     // 105
};                                                                                       // 106
                                                                                         // 107
// XXX Refactor as part of implementing real routing.                                    // 108
WebAppInternals.identifyBrowser = identifyBrowser;                                       // 109
                                                                                         // 110
WebApp.categorizeRequest = function (req) {                                              // 111
  return {                                                                               // 112
    browser: identifyBrowser(req.headers['user-agent']),                                 // 113
    url: url.parse(req.url, true)                                                        // 114
  };                                                                                     // 115
};                                                                                       // 116
                                                                                         // 117
// HTML attribute hooks: functions to be called to determine any attributes to           // 118
// be added to the '<html>' tag. Each function is passed a 'request' object (see         // 119
// #BrowserIdentification) and should return a string,                                   // 120
var htmlAttributeHooks = [];                                                             // 121
var getHtmlAttributes = function (request) {                                             // 122
  var combinedAttributes  = {};                                                          // 123
  _.each(htmlAttributeHooks || [], function (hook) {                                     // 124
    var attributes = hook(request);                                                      // 125
    if (attributes === null)                                                             // 126
      return;                                                                            // 127
    if (typeof attributes !== 'object')                                                  // 128
      throw Error("HTML attribute hook must return null or object");                     // 129
    _.extend(combinedAttributes, attributes);                                            // 130
  });                                                                                    // 131
  return combinedAttributes;                                                             // 132
};                                                                                       // 133
WebApp.addHtmlAttributeHook = function (hook) {                                          // 134
  htmlAttributeHooks.push(hook);                                                         // 135
};                                                                                       // 136
                                                                                         // 137
// Serve app HTML for this URL?                                                          // 138
var appUrl = function (url) {                                                            // 139
  if (url === '/favicon.ico' || url === '/robots.txt')                                   // 140
    return false;                                                                        // 141
                                                                                         // 142
  // NOTE: app.manifest is not a web standard like favicon.ico and                       // 143
  // robots.txt. It is a file name we have chosen to use for HTML5                       // 144
  // appcache URLs. It is included here to prevent using an appcache                     // 145
  // then removing it from poisoning an app permanently. Eventually,                     // 146
  // once we have server side routing, this won't be needed as                           // 147
  // unknown URLs with return a 404 automatically.                                       // 148
  if (url === '/app.manifest')                                                           // 149
    return false;                                                                        // 150
                                                                                         // 151
  // Avoid serving app HTML for declared routes such as /sockjs/.                        // 152
  if (RoutePolicy.classify(url))                                                         // 153
    return false;                                                                        // 154
                                                                                         // 155
  // we currently return app HTML on all URLs by default                                 // 156
  return true;                                                                           // 157
};                                                                                       // 158
                                                                                         // 159
                                                                                         // 160
// Calculate a hash of all the client resources downloaded by the                        // 161
// browser, including the application HTML, runtime config, code, and                    // 162
// static files.                                                                         // 163
//                                                                                       // 164
// This hash *must* change if any resources seen by the browser                          // 165
// change, and ideally *doesn't* change for any server-only changes                      // 166
// (but the second is a performance enhancement, not a hard                              // 167
// requirement).                                                                         // 168
                                                                                         // 169
var calculateClientHash = function () {                                                  // 170
  var hash = crypto.createHash('sha1');                                                  // 171
  hash.update(JSON.stringify(__meteor_runtime_config__), 'utf8');                        // 172
  _.each(WebApp.clientProgram.manifest, function (resource) {                            // 173
    if (resource.where === 'client' || resource.where === 'internal') {                  // 174
      hash.update(resource.path);                                                        // 175
      hash.update(resource.hash);                                                        // 176
    }                                                                                    // 177
  });                                                                                    // 178
  return hash.digest('hex');                                                             // 179
};                                                                                       // 180
                                                                                         // 181
                                                                                         // 182
// We need to calculate the client hash after all packages have loaded                   // 183
// to give them a chance to populate __meteor_runtime_config__.                          // 184
//                                                                                       // 185
// Calculating the hash during startup means that packages can only                      // 186
// populate __meteor_runtime_config__ during load, not during startup.                   // 187
//                                                                                       // 188
// Calculating instead it at the beginning of main after all startup                     // 189
// hooks had run would allow packages to also populate                                   // 190
// __meteor_runtime_config__ during startup, but that's too late for                     // 191
// autoupdate because it needs to have the client hash at startup to                     // 192
// insert the auto update version itself into                                            // 193
// __meteor_runtime_config__ to get it to the client.                                    // 194
//                                                                                       // 195
// An alternative would be to give autoupdate a "post-start,                             // 196
// pre-listen" hook to allow it to insert the auto update version at                     // 197
// the right moment.                                                                     // 198
                                                                                         // 199
Meteor.startup(function () {                                                             // 200
  WebApp.clientHash = calculateClientHash();                                             // 201
});                                                                                      // 202
                                                                                         // 203
                                                                                         // 204
                                                                                         // 205
// When we have a request pending, we want the socket timeout to be long, to             // 206
// give ourselves a while to serve it, and to allow sockjs long polls to                 // 207
// complete.  On the other hand, we want to close idle sockets relatively                // 208
// quickly, so that we can shut down relatively promptly but cleanly, without            // 209
// cutting off anyone's response.                                                        // 210
WebApp._timeoutAdjustmentRequestCallback = function (req, res) {                         // 211
  // this is really just req.socket.setTimeout(LONG_SOCKET_TIMEOUT);                     // 212
  req.setTimeout(LONG_SOCKET_TIMEOUT);                                                   // 213
  // Insert our new finish listener to run BEFORE the existing one which removes         // 214
  // the response from the socket.                                                       // 215
  var finishListeners = res.listeners('finish');                                         // 216
  // XXX Apparently in Node 0.12 this event is now called 'prefinish'.                   // 217
  // https://github.com/joyent/node/commit/7c9b6070                                      // 218
  res.removeAllListeners('finish');                                                      // 219
  res.on('finish', function () {                                                         // 220
    res.setTimeout(SHORT_SOCKET_TIMEOUT);                                                // 221
  });                                                                                    // 222
  _.each(finishListeners, function (l) { res.on('finish', l); });                        // 223
};                                                                                       // 224
                                                                                         // 225
// Will be updated by main before we listen.                                             // 226
var boilerplateTemplate = null;                                                          // 227
var boilerplateBaseData = null;                                                          // 228
var memoizedBoilerplate = {};                                                            // 229
                                                                                         // 230
// Given a request (as returned from `categorizeRequest`), return the                    // 231
// boilerplate HTML to serve for that request. Memoizes on HTML                          // 232
// attributes (used by, eg, appcache) and whether inline scripts are                     // 233
// currently allowed.                                                                    // 234
var getBoilerplate = function (request) {                                                // 235
  var htmlAttributes = getHtmlAttributes(request);                                       // 236
                                                                                         // 237
  // The only thing that changes from request to request (for now) are                   // 238
  // the HTML attributes (used by, eg, appcache) and whether inline                      // 239
  // scripts are allowed, so we can memoize based on that.                               // 240
  var boilerplateKey = JSON.stringify({                                                  // 241
    inlineScriptsAllowed: inlineScriptsAllowed,                                          // 242
    htmlAttributes: htmlAttributes                                                       // 243
  });                                                                                    // 244
                                                                                         // 245
  if (! _.has(memoizedBoilerplate, boilerplateKey)) {                                    // 246
    var boilerplateData = _.extend({                                                     // 247
      htmlAttributes: htmlAttributes,                                                    // 248
      inlineScriptsAllowed: WebAppInternals.inlineScriptsAllowed()                       // 249
    }, boilerplateBaseData);                                                             // 250
    var boilerplateInstance = boilerplateTemplate.extend({                               // 251
      data: boilerplateData                                                              // 252
    });                                                                                  // 253
    var boilerplateHtmlJs = boilerplateInstance.render();                                // 254
    memoizedBoilerplate[boilerplateKey] = "<!DOCTYPE html>\n" +                          // 255
      HTML.toHTML(boilerplateHtmlJs, boilerplateInstance);                               // 256
  }                                                                                      // 257
  return memoizedBoilerplate[boilerplateKey];                                            // 258
};                                                                                       // 259
                                                                                         // 260
// Serve static files from the manifest or added with                                    // 261
// `addStaticJs`. Exported for tests.                                                    // 262
// Options are:                                                                          // 263
//   - staticFiles: object mapping pathname of file in manifest -> {                     // 264
//     path, cacheable, sourceMapUrl, type }                                             // 265
//   - clientDir: root directory for static files from client manifest                   // 266
WebAppInternals.staticFilesMiddleware = function (options, req, res, next) {             // 267
  if ('GET' != req.method && 'HEAD' != req.method) {                                     // 268
    next();                                                                              // 269
    return;                                                                              // 270
  }                                                                                      // 271
  var pathname = connect.utils.parseUrl(req).pathname;                                   // 272
  var staticFiles = options.staticFiles;                                                 // 273
  var clientDir = options.clientDir;                                                     // 274
                                                                                         // 275
  try {                                                                                  // 276
    pathname = decodeURIComponent(pathname);                                             // 277
  } catch (e) {                                                                          // 278
    next();                                                                              // 279
    return;                                                                              // 280
  }                                                                                      // 281
                                                                                         // 282
  var serveStaticJs = function (s) {                                                     // 283
    res.writeHead(200, {                                                                 // 284
      'Content-type': 'application/javascript; charset=UTF-8'                            // 285
    });                                                                                  // 286
    res.write(s);                                                                        // 287
    res.end();                                                                           // 288
  };                                                                                     // 289
                                                                                         // 290
  if (pathname === "/meteor_runtime_config.js" &&                                        // 291
      ! WebAppInternals.inlineScriptsAllowed()) {                                        // 292
    serveStaticJs("__meteor_runtime_config__ = " +                                       // 293
                  JSON.stringify(__meteor_runtime_config__) + ";");                      // 294
    return;                                                                              // 295
  } else if (_.has(additionalStaticJs, pathname) &&                                      // 296
             ! WebAppInternals.inlineScriptsAllowed()) {                                 // 297
    serveStaticJs(additionalStaticJs[pathname]);                                         // 298
    return;                                                                              // 299
  }                                                                                      // 300
                                                                                         // 301
  if (!_.has(staticFiles, pathname)) {                                                   // 302
    next();                                                                              // 303
    return;                                                                              // 304
  }                                                                                      // 305
                                                                                         // 306
  // We don't need to call pause because, unlike 'static', once we call into             // 307
  // 'send' and yield to the event loop, we never call another handler with              // 308
  // 'next'.                                                                             // 309
                                                                                         // 310
  var info = staticFiles[pathname];                                                      // 311
                                                                                         // 312
  // Cacheable files are files that should never change. Typically                       // 313
  // named by their hash (eg meteor bundled js and css files).                           // 314
  // We cache them ~forever (1yr).                                                       // 315
  //                                                                                     // 316
  // We cache non-cacheable files anyway. This isn't really correct, as users            // 317
  // can change the files and changes won't propagate immediately. However, if           // 318
  // we don't cache them, browsers will 'flicker' when rerendering                       // 319
  // images. Eventually we will probably want to rewrite URLs of static assets           // 320
  // to include a query parameter to bust caches. That way we can both get               // 321
  // good caching behavior and allow users to change assets without delay.               // 322
  // https://github.com/meteor/meteor/issues/773                                         // 323
  var maxAge = info.cacheable                                                            // 324
        ? 1000 * 60 * 60 * 24 * 365                                                      // 325
        : 1000 * 60 * 60 * 24;                                                           // 326
                                                                                         // 327
  // Set the X-SourceMap header, which current Chrome understands.                       // 328
  // (The files also contain '//#' comments which FF 24 understands and                  // 329
  // Chrome doesn't understand yet.)                                                     // 330
  //                                                                                     // 331
  // Eventually we should set the SourceMap header but the current version of            // 332
  // Chrome and no version of FF supports it.                                            // 333
  //                                                                                     // 334
  // To figure out if your version of Chrome should support the SourceMap                // 335
  // header,                                                                             // 336
  //   - go to chrome://version. Let's say the Chrome version is                         // 337
  //      28.0.1500.71 and the Blink version is 537.36 (@153022)                         // 338
  //   - go to http://src.chromium.org/viewvc/blink/branches/chromium/1500/Source/core/inspector/InspectorPageAgent.cpp?view=log
  //     where the "1500" is the third part of your Chrome version                       // 340
  //   - find the first revision that is no greater than the "153022"                    // 341
  //     number.  That's probably the first one and it probably has                      // 342
  //     a message of the form "Branch 1500 - blink@r149738"                             // 343
  //   - If *that* revision number (149738) is at least 151755,                          // 344
  //     then Chrome should support SourceMap (not just X-SourceMap)                     // 345
  // (The change is https://codereview.chromium.org/15832007)                            // 346
  //                                                                                     // 347
  // You also need to enable source maps in Chrome: open dev tools, click                // 348
  // the gear in the bottom right corner, and select "enable source maps".               // 349
  //                                                                                     // 350
  // Firefox 23+ supports source maps but doesn't support either header yet,             // 351
  // so we include the '//#' comment for it:                                             // 352
  //   https://bugzilla.mozilla.org/show_bug.cgi?id=765993                               // 353
  // In FF 23 you need to turn on `devtools.debugger.source-maps-enabled`                // 354
  // in `about:config` (it is on by default in FF 24).                                   // 355
  if (info.sourceMapUrl)                                                                 // 356
    res.setHeader('X-SourceMap', info.sourceMapUrl);                                     // 357
                                                                                         // 358
  if (info.type === "js") {                                                              // 359
    res.setHeader("Content-Type", "application/javascript; charset=UTF-8");              // 360
  } else if (info.type === "css") {                                                      // 361
    res.setHeader("Content-Type", "text/css; charset=UTF-8");                            // 362
  }                                                                                      // 363
                                                                                         // 364
  send(req, path.join(clientDir, info.path))                                             // 365
    .maxage(maxAge)                                                                      // 366
    .hidden(true)  // if we specified a dotfile in the manifest, serve it                // 367
    .on('error', function (err) {                                                        // 368
      Log.error("Error serving static file " + err);                                     // 369
      res.writeHead(500);                                                                // 370
      res.end();                                                                         // 371
    })                                                                                   // 372
    .on('directory', function () {                                                       // 373
      Log.error("Unexpected directory " + info.path);                                    // 374
      res.writeHead(500);                                                                // 375
      res.end();                                                                         // 376
    })                                                                                   // 377
    .pipe(res);                                                                          // 378
};                                                                                       // 379
                                                                                         // 380
var runWebAppServer = function () {                                                      // 381
  var shuttingDown = false;                                                              // 382
  // read the control for the client we'll be serving up                                 // 383
  var clientJsonPath = path.join(__meteor_bootstrap__.serverDir,                         // 384
                                 __meteor_bootstrap__.configJson.client);                // 385
  var clientDir = path.dirname(clientJsonPath);                                          // 386
  var clientJson = JSON.parse(fs.readFileSync(clientJsonPath, 'utf8'));                  // 387
                                                                                         // 388
  if (clientJson.format !== "browser-program-pre1")                                      // 389
    throw new Error("Unsupported format for client assets: " +                           // 390
                    JSON.stringify(clientJson.format));                                  // 391
                                                                                         // 392
  // webserver                                                                           // 393
  var app = connect();                                                                   // 394
                                                                                         // 395
  // Auto-compress any json, javascript, or text.                                        // 396
  app.use(connect.compress());                                                           // 397
                                                                                         // 398
  // Packages and apps can add handlers that run before any other Meteor                 // 399
  // handlers via WebApp.rawConnectHandlers.                                             // 400
  var rawConnectHandlers = connect();                                                    // 401
  app.use(rawConnectHandlers);                                                           // 402
                                                                                         // 403
  // Strip off the path prefix, if it exists.                                            // 404
  app.use(function (request, response, next) {                                           // 405
    var pathPrefix = __meteor_runtime_config__.ROOT_URL_PATH_PREFIX;                     // 406
    var url = Npm.require('url').parse(request.url);                                     // 407
    var pathname = url.pathname;                                                         // 408
    // check if the path in the url starts with the path prefix (and the part            // 409
    // after the path prefix must start with a / if it exists.)                          // 410
    if (pathPrefix && pathname.substring(0, pathPrefix.length) === pathPrefix &&         // 411
       (pathname.length == pathPrefix.length                                             // 412
        || pathname.substring(pathPrefix.length, pathPrefix.length + 1) === "/")) {      // 413
      request.url = request.url.substring(pathPrefix.length);                            // 414
      next();                                                                            // 415
    } else if (pathname === "/favicon.ico" || pathname === "/robots.txt") {              // 416
      next();                                                                            // 417
    } else if (pathPrefix) {                                                             // 418
      response.writeHead(404);                                                           // 419
      response.write("Unknown path");                                                    // 420
      response.end();                                                                    // 421
    } else {                                                                             // 422
      next();                                                                            // 423
    }                                                                                    // 424
  });                                                                                    // 425
                                                                                         // 426
  // Parse the query string into res.query. Used by oauth_server, but it's               // 427
  // generally pretty handy..                                                            // 428
  app.use(connect.query());                                                              // 429
                                                                                         // 430
  var getItemPathname = function (itemUrl) {                                             // 431
    return decodeURIComponent(url.parse(itemUrl).pathname);                              // 432
  };                                                                                     // 433
                                                                                         // 434
  var staticFiles = {};                                                                  // 435
  _.each(clientJson.manifest, function (item) {                                          // 436
    if (item.url && item.where === "client") {                                           // 437
      staticFiles[getItemPathname(item.url)] = {                                         // 438
        path: item.path,                                                                 // 439
        cacheable: item.cacheable,                                                       // 440
        // Link from source to its map                                                   // 441
        sourceMapUrl: item.sourceMapUrl,                                                 // 442
        type: item.type                                                                  // 443
      };                                                                                 // 444
                                                                                         // 445
      if (item.sourceMap) {                                                              // 446
        // Serve the source map too, under the specified URL. We assume all              // 447
        // source maps are cacheable.                                                    // 448
        staticFiles[getItemPathname(item.sourceMapUrl)] = {                              // 449
          path: item.sourceMap,                                                          // 450
          cacheable: true                                                                // 451
        };                                                                               // 452
      }                                                                                  // 453
    }                                                                                    // 454
  });                                                                                    // 455
                                                                                         // 456
  // Exported for tests.                                                                 // 457
  WebAppInternals.staticFiles = staticFiles;                                             // 458
                                                                                         // 459
                                                                                         // 460
  // Serve static files from the manifest.                                               // 461
  // This is inspired by the 'static' middleware.                                        // 462
  app.use(function (req, res, next) {                                                    // 463
    return WebAppInternals.staticFilesMiddleware({                                       // 464
      staticFiles: staticFiles,                                                          // 465
      clientDir: clientDir                                                               // 466
    }, req, res, next);                                                                  // 467
  });                                                                                    // 468
                                                                                         // 469
  // Packages and apps can add handlers to this via WebApp.connectHandlers.              // 470
  // They are inserted before our default handler.                                       // 471
  var packageAndAppHandlers = connect();                                                 // 472
  app.use(packageAndAppHandlers);                                                        // 473
                                                                                         // 474
  var suppressConnectErrors = false;                                                     // 475
  // connect knows it is an error handler because it has 4 arguments instead of          // 476
  // 3. go figure.  (It is not smart enough to find such a thing if it's hidden          // 477
  // inside packageAndAppHandlers.)                                                      // 478
  app.use(function (err, req, res, next) {                                               // 479
    if (!err || !suppressConnectErrors || !req.headers['x-suppress-error']) {            // 480
      next(err);                                                                         // 481
      return;                                                                            // 482
    }                                                                                    // 483
    res.writeHead(err.status, { 'Content-Type': 'text/plain' });                         // 484
    res.end("An error message");                                                         // 485
  });                                                                                    // 486
                                                                                         // 487
  app.use(function (req, res, next) {                                                    // 488
    if (! appUrl(req.url))                                                               // 489
      return next();                                                                     // 490
                                                                                         // 491
    if (!boilerplateTemplate)                                                            // 492
      throw new Error("boilerplateTemplate should be set before listening!");            // 493
    if (!boilerplateBaseData)                                                            // 494
      throw new Error("boilerplateBaseData should be set before listening!");            // 495
                                                                                         // 496
    var headers = {                                                                      // 497
      'Content-Type':  'text/html; charset=utf-8'                                        // 498
    };                                                                                   // 499
    if (shuttingDown)                                                                    // 500
      headers['Connection'] = 'Close';                                                   // 501
                                                                                         // 502
    var request = WebApp.categorizeRequest(req);                                         // 503
                                                                                         // 504
    if (request.url.query && request.url.query['meteor_css_resource']) {                 // 505
      // In this case, we're requesting a CSS resource in the meteor-specific            // 506
      // way, but we don't have it.  Serve a static css file that indicates that         // 507
      // we didn't have it, so we can detect that and refresh.                           // 508
      headers['Content-Type'] = 'text/css; charset=utf-8';                               // 509
      res.writeHead(200, headers);                                                       // 510
      res.write(".meteor-css-not-found-error { width: 0px;}");                           // 511
      res.end();                                                                         // 512
      return undefined;                                                                  // 513
    }                                                                                    // 514
                                                                                         // 515
    var boilerplate;                                                                     // 516
    try {                                                                                // 517
      boilerplate = getBoilerplate(request);                                             // 518
    } catch (e) {                                                                        // 519
      Log.error("Error running template: " + e);                                         // 520
      res.writeHead(500, headers);                                                       // 521
      res.end();                                                                         // 522
      return undefined;                                                                  // 523
    }                                                                                    // 524
                                                                                         // 525
    res.writeHead(200, headers);                                                         // 526
    res.write(boilerplate);                                                              // 527
    res.end();                                                                           // 528
    return undefined;                                                                    // 529
  });                                                                                    // 530
                                                                                         // 531
  // Return 404 by default, if no other handlers serve this URL.                         // 532
  app.use(function (req, res) {                                                          // 533
    res.writeHead(404);                                                                  // 534
    res.end();                                                                           // 535
  });                                                                                    // 536
                                                                                         // 537
                                                                                         // 538
  var httpServer = http.createServer(app);                                               // 539
  var onListeningCallbacks = [];                                                         // 540
                                                                                         // 541
  // After 5 seconds w/o data on a socket, kill it.  On the other hand, if               // 542
  // there's an outstanding request, give it a higher timeout instead (to avoid          // 543
  // killing long-polling requests)                                                      // 544
  httpServer.setTimeout(SHORT_SOCKET_TIMEOUT);                                           // 545
                                                                                         // 546
  // Do this here, and then also in livedata/stream_server.js, because                   // 547
  // stream_server.js kills all the current request handlers when installing its         // 548
  // own.                                                                                // 549
  httpServer.on('request', WebApp._timeoutAdjustmentRequestCallback);                    // 550
                                                                                         // 551
                                                                                         // 552
  // For now, handle SIGHUP here.  Later, this should be in some centralized             // 553
  // Meteor shutdown code.                                                               // 554
  process.on('SIGHUP', Meteor.bindEnvironment(function () {                              // 555
    shuttingDown = true;                                                                 // 556
    // tell others with websockets open that we plan to close this.                      // 557
    // XXX: Eventually, this should be done with a standard meteor shut-down             // 558
    // logic path.                                                                       // 559
    httpServer.emit('meteor-closing');                                                   // 560
                                                                                         // 561
    httpServer.close(Meteor.bindEnvironment(function () {                                // 562
      if (proxy) {                                                                       // 563
        try {                                                                            // 564
          proxy.call('removeBindingsForJob', process.env.GALAXY_JOB);                    // 565
        } catch (e) {                                                                    // 566
          Log.error("Error removing bindings: " + e.message);                            // 567
          process.exit(1);                                                               // 568
        }                                                                                // 569
      }                                                                                  // 570
      process.exit(0);                                                                   // 571
                                                                                         // 572
    }, "On http server close failed"));                                                  // 573
                                                                                         // 574
    // Ideally we will close before this hits.                                           // 575
    Meteor.setTimeout(function () {                                                      // 576
      Log.warn("Closed by SIGHUP but one or more HTTP requests may not have finished."); // 577
      process.exit(1);                                                                   // 578
    }, 5000);                                                                            // 579
                                                                                         // 580
  }, function (err) {                                                                    // 581
    console.log(err);                                                                    // 582
    process.exit(1);                                                                     // 583
  }));                                                                                   // 584
                                                                                         // 585
  // start up app                                                                        // 586
  _.extend(WebApp, {                                                                     // 587
    connectHandlers: packageAndAppHandlers,                                              // 588
    rawConnectHandlers: rawConnectHandlers,                                              // 589
    httpServer: httpServer,                                                              // 590
    // metadata about the client program that we serve                                   // 591
    clientProgram: {                                                                     // 592
      manifest: clientJson.manifest                                                      // 593
      // XXX do we need a "root: clientDir" field here? it used to be here but           // 594
      // was unused.                                                                     // 595
    },                                                                                   // 596
    // For testing.                                                                      // 597
    suppressConnectErrors: function () {                                                 // 598
      suppressConnectErrors = true;                                                      // 599
    },                                                                                   // 600
    onListening: function (f) {                                                          // 601
      if (onListeningCallbacks)                                                          // 602
        onListeningCallbacks.push(f);                                                    // 603
      else                                                                               // 604
        f();                                                                             // 605
    },                                                                                   // 606
    // Hack: allow http tests to call connect.basicAuth without making them              // 607
    // Npm.depends on another copy of connect. (That would be fine if we could           // 608
    // have test-only NPM dependencies but is overkill here.)                            // 609
    __basicAuth__: connect.basicAuth                                                     // 610
  });                                                                                    // 611
                                                                                         // 612
  // Let the rest of the packages (and Meteor.startup hooks) insert connect              // 613
  // middlewares and update __meteor_runtime_config__, then keep going to set up         // 614
  // actually serving HTML.                                                              // 615
  main = function (argv) {                                                               // 616
    // main happens post startup hooks, so we don't need a Meteor.startup() to           // 617
    // ensure this happens after the galaxy package is loaded.                           // 618
    var AppConfig = Package["application-configuration"].AppConfig;                      // 619
    // We used to use the optimist npm package to parse argv here, but it's              // 620
    // overkill (and no longer in the dev bundle). Just assume any instance of           // 621
    // '--keepalive' is a use of the option.                                             // 622
    var expectKeepalives = _.contains(argv, '--keepalive');                              // 623
                                                                                         // 624
    boilerplateBaseData = {                                                              // 625
      // 'htmlAttributes' and 'inlineScriptsAllowed' are set at render                   // 626
      // time, because they are allowed to change from request to                        // 627
      // request.                                                                        // 628
      css: [],                                                                           // 629
      js: [],                                                                            // 630
      head: '',                                                                          // 631
      body: '',                                                                          // 632
      additionalStaticJs: _.map(                                                         // 633
        additionalStaticJs,                                                              // 634
        function (contents, pathname) {                                                  // 635
          return {                                                                       // 636
            pathname: pathname,                                                          // 637
            contents: contents                                                           // 638
          };                                                                             // 639
        }                                                                                // 640
      ),                                                                                 // 641
      meteorRuntimeConfig: JSON.stringify(__meteor_runtime_config__),                    // 642
      rootUrlPathPrefix: __meteor_runtime_config__.ROOT_URL_PATH_PREFIX || '',           // 643
      bundledJsCssPrefix: bundledJsCssPrefix ||                                          // 644
        __meteor_runtime_config__.ROOT_URL_PATH_PREFIX || ''                             // 645
    };                                                                                   // 646
                                                                                         // 647
    _.each(WebApp.clientProgram.manifest, function (item) {                              // 648
      if (item.type === 'css' && item.where === 'client') {                              // 649
        boilerplateBaseData.css.push({url: item.url});                                   // 650
      }                                                                                  // 651
      if (item.type === 'js' && item.where === 'client') {                               // 652
        boilerplateBaseData.js.push({url: item.url});                                    // 653
      }                                                                                  // 654
      if (item.type === 'head') {                                                        // 655
        boilerplateBaseData.head = fs.readFileSync(                                      // 656
          path.join(clientDir, item.path), 'utf8');                                      // 657
      }                                                                                  // 658
      if (item.type === 'body') {                                                        // 659
        boilerplateBaseData.body = fs.readFileSync(                                      // 660
          path.join(clientDir, item.path), 'utf8');                                      // 661
      }                                                                                  // 662
    });                                                                                  // 663
                                                                                         // 664
    var boilerplateTemplateSource = Assets.getText("boilerplate.html");                  // 665
    var boilerplateRenderCode = Spacebars.compile(                                       // 666
      boilerplateTemplateSource, { isBody: true });                                      // 667
                                                                                         // 668
    // Note that we are actually depending on eval's local environment capture           // 669
    // so that UI and HTML are visible to the eval'd code.                               // 670
    var boilerplateRender = eval(boilerplateRenderCode);                                 // 671
                                                                                         // 672
    boilerplateTemplate = UI.Component.extend({                                          // 673
      kind: "MainPage",                                                                  // 674
      render: boilerplateRender                                                          // 675
    });                                                                                  // 676
                                                                                         // 677
    // only start listening after all the startup code has run.                          // 678
    var localPort = parseInt(process.env.PORT) || 0;                                     // 679
    var host = process.env.BIND_IP;                                                      // 680
    var localIp = host || '0.0.0.0';                                                     // 681
    httpServer.listen(localPort, localIp, Meteor.bindEnvironment(function() {            // 682
      if (expectKeepalives)                                                              // 683
        console.log("LISTENING"); // must match run-app.js                               // 684
      var proxyBinding;                                                                  // 685
                                                                                         // 686
      AppConfig.configurePackage('webapp', function (configuration) {                    // 687
        if (proxyBinding)                                                                // 688
          proxyBinding.stop();                                                           // 689
        if (configuration && configuration.proxy) {                                      // 690
          // TODO: We got rid of the place where this checks the app's                   // 691
          // configuration, because this wants to be configured for some things          // 692
          // on a per-job basis.  Discuss w/ teammates.                                  // 693
          proxyBinding = AppConfig.configureService(                                     // 694
            "proxy",                                                                     // 695
            "pre0",                                                                      // 696
            function (proxyService) {                                                    // 697
              if (proxyService && ! _.isEmpty(proxyService)) {                           // 698
                var proxyConf;                                                           // 699
                // XXX Figure out a per-job way to specify bind location                 // 700
                // (besides hardcoding the location for ADMIN_APP jobs).                 // 701
                if (process.env.ADMIN_APP) {                                             // 702
                  var bindPathPrefix = "";                                               // 703
                  if (process.env.GALAXY_APP !== "panel") {                              // 704
                    bindPathPrefix = "/" + bindPathPrefix +                              // 705
                      encodeURIComponent(                                                // 706
                        process.env.GALAXY_APP                                           // 707
                      ).replace(/\./g, '_');                                             // 708
                  }                                                                      // 709
                  proxyConf = {                                                          // 710
                    bindHost: process.env.GALAXY_NAME,                                   // 711
                    bindPathPrefix: bindPathPrefix,                                      // 712
                    requiresAuth: true                                                   // 713
                  };                                                                     // 714
                } else {                                                                 // 715
                  proxyConf = configuration.proxy;                                       // 716
                }                                                                        // 717
                Log("Attempting to bind to proxy at " +                                  // 718
                    proxyService);                                                       // 719
                WebAppInternals.bindToProxy(_.extend({                                   // 720
                  proxyEndpoint: proxyService                                            // 721
                }, proxyConf));                                                          // 722
              }                                                                          // 723
            }                                                                            // 724
          );                                                                             // 725
        }                                                                                // 726
      });                                                                                // 727
                                                                                         // 728
      var callbacks = onListeningCallbacks;                                              // 729
      onListeningCallbacks = null;                                                       // 730
      _.each(callbacks, function (x) { x(); });                                          // 731
                                                                                         // 732
    }, function (e) {                                                                    // 733
      console.error("Error listening:", e);                                              // 734
      console.error(e && e.stack);                                                       // 735
    }));                                                                                 // 736
                                                                                         // 737
    if (expectKeepalives)                                                                // 738
      initKeepalive();                                                                   // 739
    return 'DAEMON';                                                                     // 740
  };                                                                                     // 741
};                                                                                       // 742
                                                                                         // 743
                                                                                         // 744
var proxy;                                                                               // 745
WebAppInternals.bindToProxy = function (proxyConfig) {                                   // 746
  var securePort = proxyConfig.securePort || 4433;                                       // 747
  var insecurePort = proxyConfig.insecurePort || 8080;                                   // 748
  var bindPathPrefix = proxyConfig.bindPathPrefix || "";                                 // 749
  // XXX also support galaxy-based lookup                                                // 750
  if (!proxyConfig.proxyEndpoint)                                                        // 751
    throw new Error("missing proxyEndpoint");                                            // 752
  if (!proxyConfig.bindHost)                                                             // 753
    throw new Error("missing bindHost");                                                 // 754
  if (!process.env.GALAXY_JOB)                                                           // 755
    throw new Error("missing $GALAXY_JOB");                                              // 756
  if (!process.env.GALAXY_APP)                                                           // 757
    throw new Error("missing $GALAXY_APP");                                              // 758
  if (!process.env.LAST_START)                                                           // 759
    throw new Error("missing $LAST_START");                                              // 760
                                                                                         // 761
  // XXX rename pid argument to bindTo.                                                  // 762
  // XXX factor out into a 'getPid' function in a 'galaxy' package?                      // 763
  var pid = {                                                                            // 764
    job: process.env.GALAXY_JOB,                                                         // 765
    lastStarted: +(process.env.LAST_START),                                              // 766
    app: process.env.GALAXY_APP                                                          // 767
  };                                                                                     // 768
  var myHost = os.hostname();                                                            // 769
                                                                                         // 770
  WebAppInternals.usingDdpProxy = true;                                                  // 771
                                                                                         // 772
  // This is run after packages are loaded (in main) so we can use                       // 773
  // Follower.connect.                                                                   // 774
  if (proxy) {                                                                           // 775
    // XXX the concept here is that our configuration has changed and                    // 776
    // we have connected to an entirely new follower set, which does                     // 777
    // not have the state that we set up on the follower set that we                     // 778
    // were previously connected to, and so we need to recreate all of                   // 779
    // our bindings -- analogous to getting a SIGHUP and rereading                       // 780
    // your configuration file. so probably this should actually tear                    // 781
    // down the connection and make a whole new one, rather than                         // 782
    // hot-reconnecting to a different URL.                                              // 783
    proxy.reconnect({                                                                    // 784
      url: proxyConfig.proxyEndpoint                                                     // 785
    });                                                                                  // 786
  } else {                                                                               // 787
    proxy = Package["follower-livedata"].Follower.connect(                               // 788
      proxyConfig.proxyEndpoint, {                                                       // 789
        group: "proxy"                                                                   // 790
      }                                                                                  // 791
    );                                                                                   // 792
  }                                                                                      // 793
                                                                                         // 794
  var route = process.env.ROUTE;                                                         // 795
  var ourHost = route.split(":")[0];                                                     // 796
  var ourPort = +route.split(":")[1];                                                    // 797
                                                                                         // 798
  var outstanding = 0;                                                                   // 799
  var startedAll = false;                                                                // 800
  var checkComplete = function () {                                                      // 801
    if (startedAll && ! outstanding)                                                     // 802
      Log("Bound to proxy.");                                                            // 803
  };                                                                                     // 804
  var makeCallback = function () {                                                       // 805
    outstanding++;                                                                       // 806
    return function (err) {                                                              // 807
      if (err)                                                                           // 808
        throw err;                                                                       // 809
      outstanding--;                                                                     // 810
      checkComplete();                                                                   // 811
    };                                                                                   // 812
  };                                                                                     // 813
                                                                                         // 814
  // for now, have our (temporary) requiresAuth flag apply to all                        // 815
  // routes created by this process.                                                     // 816
  var requiresDdpAuth = !! proxyConfig.requiresAuth;                                     // 817
  var requiresHttpAuth = (!! proxyConfig.requiresAuth) &&                                // 818
        (pid.app !== "panel" && pid.app !== "auth");                                     // 819
                                                                                         // 820
  // XXX a current limitation is that we treat securePort and                            // 821
  // insecurePort as a global configuration parameter -- we assume                       // 822
  // that if the proxy wants us to ask for 8080 to get port 80 traffic                   // 823
  // on our default hostname, that's the same port that we would use                     // 824
  // to get traffic on some other hostname that our proxy listens                        // 825
  // for. Likewise, we assume that if the proxy can receive secure                       // 826
  // traffic for our domain, it can assume secure traffic for any                        // 827
  // domain! Hopefully this will get cleaned up before too long by                       // 828
  // pushing that logic into the proxy service, so we can just ask for                   // 829
  // port 80.                                                                            // 830
                                                                                         // 831
  // XXX BUG: if our configuration changes, and bindPathPrefix                           // 832
  // changes, it appears that we will not remove the routes derived                      // 833
  // from the old bindPathPrefix from the proxy (until the process                       // 834
  // exits). It is not actually normal for bindPathPrefix to change,                     // 835
  // certainly not without a process restart for other reasons, but                      // 836
  // it'd be nice to fix.                                                                // 837
                                                                                         // 838
  _.each(routes, function (route) {                                                      // 839
    var parsedUrl = url.parse(route.url, /* parseQueryString */ false,                   // 840
                              /* slashesDenoteHost aka workRight */ true);               // 841
    if (parsedUrl.protocol || parsedUrl.port || parsedUrl.search)                        // 842
      throw new Error("Bad url");                                                        // 843
    parsedUrl.host = null;                                                               // 844
    parsedUrl.path = null;                                                               // 845
    if (! parsedUrl.hostname) {                                                          // 846
      parsedUrl.hostname = proxyConfig.bindHost;                                         // 847
      if (! parsedUrl.pathname)                                                          // 848
        parsedUrl.pathname = "";                                                         // 849
      if (! parsedUrl.pathname.indexOf("/") !== 0) {                                     // 850
        // Relative path                                                                 // 851
        parsedUrl.pathname = bindPathPrefix + parsedUrl.pathname;                        // 852
      }                                                                                  // 853
    }                                                                                    // 854
    var version = "";                                                                    // 855
                                                                                         // 856
    var AppConfig = Package["application-configuration"].AppConfig;                      // 857
    version = AppConfig.getStarForThisJob() || "";                                       // 858
                                                                                         // 859
                                                                                         // 860
    var parsedDdpUrl = _.clone(parsedUrl);                                               // 861
    parsedDdpUrl.protocol = "ddp";                                                       // 862
    // Node has a hardcoded list of protocols that get '://' instead                     // 863
    // of ':'. ddp needs to be added to that whitelist. Until then, we                   // 864
    // can set the undocumented attribute 'slashes' to get the right                     // 865
    // behavior. It's not clear whether than is by design or accident.                   // 866
    parsedDdpUrl.slashes = true;                                                         // 867
    parsedDdpUrl.port = '' + securePort;                                                 // 868
    var ddpUrl = url.format(parsedDdpUrl);                                               // 869
                                                                                         // 870
    var proxyToHost, proxyToPort, proxyToPathPrefix;                                     // 871
    if (! _.has(route, 'forwardTo')) {                                                   // 872
      proxyToHost = ourHost;                                                             // 873
      proxyToPort = ourPort;                                                             // 874
      proxyToPathPrefix = parsedUrl.pathname;                                            // 875
    } else {                                                                             // 876
      var parsedFwdUrl = url.parse(route.forwardTo, false, true);                        // 877
      if (! parsedFwdUrl.hostname || parsedFwdUrl.protocol)                              // 878
        throw new Error("Bad forward url");                                              // 879
      proxyToHost = parsedFwdUrl.hostname;                                               // 880
      proxyToPort = parseInt(parsedFwdUrl.port || "80");                                 // 881
      proxyToPathPrefix = parsedFwdUrl.pathname || "";                                   // 882
    }                                                                                    // 883
                                                                                         // 884
    if (route.ddp) {                                                                     // 885
      proxy.call('bindDdp', {                                                            // 886
        pid: pid,                                                                        // 887
        bindTo: {                                                                        // 888
          ddpUrl: ddpUrl,                                                                // 889
          insecurePort: insecurePort                                                     // 890
        },                                                                               // 891
        proxyTo: {                                                                       // 892
          tags: [version],                                                               // 893
          host: proxyToHost,                                                             // 894
          port: proxyToPort,                                                             // 895
          pathPrefix: proxyToPathPrefix + '/websocket'                                   // 896
        },                                                                               // 897
        requiresAuth: requiresDdpAuth                                                    // 898
      }, makeCallback());                                                                // 899
    }                                                                                    // 900
                                                                                         // 901
    if (route.http) {                                                                    // 902
      proxy.call('bindHttp', {                                                           // 903
        pid: pid,                                                                        // 904
        bindTo: {                                                                        // 905
          host: parsedUrl.hostname,                                                      // 906
          port: insecurePort,                                                            // 907
          pathPrefix: parsedUrl.pathname                                                 // 908
        },                                                                               // 909
        proxyTo: {                                                                       // 910
          tags: [version],                                                               // 911
          host: proxyToHost,                                                             // 912
          port: proxyToPort,                                                             // 913
          pathPrefix: proxyToPathPrefix                                                  // 914
        },                                                                               // 915
        requiresAuth: requiresHttpAuth                                                   // 916
      }, makeCallback());                                                                // 917
                                                                                         // 918
      // Only make the secure binding if we've been told that the                        // 919
      // proxy knows how terminate secure connections for us (has an                     // 920
      // appropriate cert, can bind the necessary port..)                                // 921
      if (proxyConfig.securePort !== null) {                                             // 922
        proxy.call('bindHttp', {                                                         // 923
          pid: pid,                                                                      // 924
          bindTo: {                                                                      // 925
            host: parsedUrl.hostname,                                                    // 926
            port: securePort,                                                            // 927
            pathPrefix: parsedUrl.pathname,                                              // 928
            ssl: true                                                                    // 929
          },                                                                             // 930
          proxyTo: {                                                                     // 931
            tags: [version],                                                             // 932
            host: proxyToHost,                                                           // 933
            port: proxyToPort,                                                           // 934
            pathPrefix: proxyToPathPrefix                                                // 935
          },                                                                             // 936
          requiresAuth: requiresHttpAuth                                                 // 937
        }, makeCallback());                                                              // 938
      }                                                                                  // 939
    }                                                                                    // 940
  });                                                                                    // 941
                                                                                         // 942
  startedAll = true;                                                                     // 943
  checkComplete();                                                                       // 944
};                                                                                       // 945
                                                                                         // 946
// (Internal, unsupported interface -- subject to change)                                // 947
//                                                                                       // 948
// Listen for HTTP and/or DDP traffic and route it somewhere. Only                       // 949
// takes effect when using a proxy service.                                              // 950
//                                                                                       // 951
// 'url' is the traffic that we want to route, interpreted relative to                   // 952
// the default URL where this app has been told to serve itself. It                      // 953
// may not have a scheme or port, but it may have a host and a path,                     // 954
// and if no host is provided the path need not be absolute. The                         // 955
// following cases are possible:                                                         // 956
//                                                                                       // 957
//   //somehost.com                                                                      // 958
//     All incoming traffic for 'somehost.com'                                           // 959
//   //somehost.com/foo/bar                                                              // 960
//     All incoming traffic for 'somehost.com', but only when                            // 961
//     the first two path components are 'foo' and 'bar'.                                // 962
//   /foo/bar                                                                            // 963
//     Incoming traffic on our default host, but only when the                           // 964
//     first two path components are 'foo' and 'bar'.                                    // 965
//   foo/bar                                                                             // 966
//     Incoming traffic on our default host, but only when the path                      // 967
//     starts with our default path prefix, followed by 'foo' and                        // 968
//     'bar'.                                                                            // 969
//                                                                                       // 970
// (Yes, these scheme-less URLs that start with '//' are legal URLs.)                    // 971
//                                                                                       // 972
// You can select either DDP traffic, HTTP traffic, or both. Both                        // 973
// secure and insecure traffic will be gathered (assuming the proxy                      // 974
// service is capable, eg, has appropriate certs and port mappings).                     // 975
//                                                                                       // 976
// With no 'forwardTo' option, the traffic is received by this process                   // 977
// for service by the hooks in this 'webapp' package. The original URL                   // 978
// is preserved (that is, if you bind "/a", and a user visits "/a/b",                    // 979
// the app receives a request with a path of "/a/b", not a path of                       // 980
// "/b").                                                                                // 981
//                                                                                       // 982
// With 'forwardTo', the process is instead sent to some other remote                    // 983
// host. The URL is adjusted by stripping the path components in 'url'                   // 984
// and putting the path components in the 'forwardTo' URL in their                       // 985
// place. For example, if you forward "//somehost/a" to                                  // 986
// "//otherhost/x", and the user types "//somehost/a/b" into their                       // 987
// browser, then otherhost will receive a request with a Host header                     // 988
// of "somehost" and a path of "/x/b".                                                   // 989
//                                                                                       // 990
// The routing continues until this process exits. For now, all of the                   // 991
// routes must be set up ahead of time, before the initial                               // 992
// registration with the proxy. Calling addRoute from the top level of                   // 993
// your JS should do the trick.                                                          // 994
//                                                                                       // 995
// When multiple routes are present that match a given request, the                      // 996
// most specific route wins. When routes with equal specificity are                      // 997
// present, the proxy service will distribute the traffic between                        // 998
// them.                                                                                 // 999
//                                                                                       // 1000
// options may be:                                                                       // 1001
// - ddp: if true, the default, include DDP traffic. This includes                       // 1002
//   both secure and insecure traffic, and both websocket and sockjs                     // 1003
//   transports.                                                                         // 1004
// - http: if true, the default, include HTTP/HTTPS traffic.                             // 1005
// - forwardTo: if provided, should be a URL with a host, optional                       // 1006
//   path and port, and no scheme (the scheme will be derived from the                   // 1007
//   traffic type; for now it will always be a http or ws connection,                    // 1008
//   never https or wss, but we could add a forwardSecure flag to                        // 1009
//   re-encrypt).                                                                        // 1010
var routes = [];                                                                         // 1011
WebAppInternals.addRoute = function (url, options) {                                     // 1012
  options = _.extend({                                                                   // 1013
    ddp: true,                                                                           // 1014
    http: true                                                                           // 1015
  }, options || {});                                                                     // 1016
                                                                                         // 1017
  if (proxy)                                                                             // 1018
    // In the future, lift this restriction                                              // 1019
    throw new Error("Too late to add routes");                                           // 1020
                                                                                         // 1021
  routes.push(_.extend({ url: url }, options));                                          // 1022
};                                                                                       // 1023
                                                                                         // 1024
// Receive traffic on our default URL.                                                   // 1025
WebAppInternals.addRoute("");                                                            // 1026
                                                                                         // 1027
runWebAppServer();                                                                       // 1028
                                                                                         // 1029
                                                                                         // 1030
var inlineScriptsAllowed = true;                                                         // 1031
                                                                                         // 1032
WebAppInternals.inlineScriptsAllowed = function () {                                     // 1033
  return inlineScriptsAllowed;                                                           // 1034
};                                                                                       // 1035
                                                                                         // 1036
WebAppInternals.setInlineScriptsAllowed = function (value) {                             // 1037
  inlineScriptsAllowed = value;                                                          // 1038
};                                                                                       // 1039
                                                                                         // 1040
WebAppInternals.setBundledJsCssPrefix = function (prefix) {                              // 1041
  bundledJsCssPrefix = prefix;                                                           // 1042
};                                                                                       // 1043
                                                                                         // 1044
// Packages can call `WebAppInternals.addStaticJs` to specify static                     // 1045
// JavaScript to be included in the app. This static JS will be inlined,                 // 1046
// unless inline scripts have been disabled, in which case it will be                    // 1047
// served under `/<sha1 of contents>`.                                                   // 1048
var additionalStaticJs = {};                                                             // 1049
WebAppInternals.addStaticJs = function (contents) {                                      // 1050
  additionalStaticJs["/" + sha1(contents) + ".js"] = contents;                           // 1051
};                                                                                       // 1052
                                                                                         // 1053
// Exported for tests                                                                    // 1054
WebAppInternals.getBoilerplate = getBoilerplate;                                         // 1055
WebAppInternals.additionalStaticJs = additionalStaticJs;                                 // 1056
                                                                                         // 1057
///////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package.webapp = {
  WebApp: WebApp,
  main: main,
  WebAppInternals: WebAppInternals
};

})();

//# sourceMappingURL=webapp.js.map
