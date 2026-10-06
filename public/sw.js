const CACHE="javis-static-v1";
const PWA_ASSETS=new Set([
  "/manifest.webmanifest",
  "/icons/javis-180.png",
  "/icons/javis-192.png",
  "/icons/javis-512.png",
  "/icons/javis-maskable-512.png"
]);

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll([...PWA_ASSETS])).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==self.location.origin)return;
  if(request.mode==="navigate"||url.pathname.startsWith("/api/")||url.pathname.startsWith("/oauth2/")||url.pathname.startsWith("/auth/"))return;
  if(!url.pathname.startsWith("/assets/")&&!PWA_ASSETS.has(url.pathname))return;
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok){const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put(request,copy))}
    return response;
  })));
});
