(function(){
'use strict';

const $=id=>document.getElementById(id);
let mode='radius';
let sourcePoint=null;
let centers=[];
let geometry=null;

const map=Vietflex.vietflexMap('map',{
  useLegacyGoogleTiles:true,
  googleMapType:'roadmap',
  zoomControl:false,
  attributionControl:false,
  center:[16.2,106.2],
  zoom:6
});
new Vietflex.ZoomControl({position:'topleft'}).addTo(map);
new Vietflex.AttributionControl({position:'bottomright'}).addTo(map);
const overlay=new Vietflex.LayerGroup().addTo(map);

function setStatus(el,msg,type){
  el.textContent=msg||'';
  el.className='status'+(type?' '+type:'');
}
function pointValid(p){
  return p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180;
}
function dedupe(points){
  const s=new Set(),out=[];
  (points||[]).forEach(p=>{
    if(!pointValid(p))return;
    const k=p.lat.toFixed(6)+','+p.lon.toFixed(6);
    if(!s.has(k)){s.add(k);out.push({lat:p.lat,lon:p.lon});}
  });
  return out;
}
function cap(points,n=250){
  if(points.length<=n)return points;
  const out=[],step=points.length/n;
  for(let i=0;i<n;i++)out.push(points[Math.floor(i*step)]);
  return out;
}
function googlePlaceName(text){
  try{
    const u=new URL(text);
    const parts=u.pathname.split('/').filter(Boolean);
    const i=parts.indexOf('place');
    if(i>=0&&parts[i+1])return decodeURIComponent(parts[i+1]).replace(/\+/g,' ').trim();
  }catch(_){}
  return 'Google Maps POI';
}
function parseGoogleMapPoint(text){
  text=String(text||'').trim();
  if(!text)return null;

  let m=text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if(m)return {lat:+m[1],lon:+m[2],source:'poi'};

  m=text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if(m)return {lat:+m[1],lon:+m[2],source:'viewport'};

  try{
    const u=new URL(text);
    for(const key of ['q','query','ll']){
      const value=u.searchParams.get(key);
      if(!value)continue;
      const q=value.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if(q)return {lat:+q[1],lon:+q[2],source:'query'};
    }
  }catch(_){}

  m=text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(m)return {lat:+m[1],lon:+m[2],source:'coords'};

  return null;
}
function parsePoints(text){
  text=String(text||'').trim();
  if(!text)return[];
  let pts=[];
  try{
    const o=JSON.parse(text),g=o.type==='Feature'?o.geometry:o;
    if(g&&g.type==='Point')pts.push({lat:+g.coordinates[1],lon:+g.coordinates[0]});
    if(g&&g.type==='LineString')g.coordinates.forEach(c=>pts.push({lat:+c[1],lon:+c[0]}));
    if(pts.length)return dedupe(pts);
  }catch(_){}
  text.split(/\r?\n|;/).forEach(line=>{
    const p=parseGoogleMapPoint(line);
    if(p)pts.push(p);
  });
  return dedupe(pts);
}
function setMode(m){
  mode=m;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.mode===m));
  document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('active',x.dataset.panel===m));
  if(m==='radius'){
    geometry=null;
    centers=sourcePoint?[sourcePoint]:[];
    updateSpatialSummary();
  }
  draw();
}
function updateSpatialSummary(){
  const badge=$('mapBadge');
  if(mode==='radius'){
    if(!sourcePoint){
      $('spatialSummary').textContent='Chưa có vị trí. Hãy dán URL Google Maps.';
      badge.textContent='Chưa có vị trí';
      return;
    }
    const r=+$('radius').value||5000;
    $('spatialSummary').textContent='Tâm '+sourcePoint.lat.toFixed(6)+', '+sourcePoint.lon.toFixed(6)+' · bán kính '+formatDistance(r);
    badge.textContent='Bán kính '+formatDistance(r);
  }else if(mode==='boundary'){
    $('spatialSummary').textContent=centers.length?centers.length+' điểm lấy mẫu trong địa giới':'Chưa nạp địa giới.';
    badge.textContent=centers.length?'Địa giới · '+centers.length+' điểm':'Chưa có địa giới';
  }else{
    $('spatialSummary').textContent=centers.length?centers.length+' điểm lấy mẫu dọc tuyến':'Chưa tạo tuyến.';
    badge.textContent=centers.length?'Tuyến · '+centers.length+' điểm':'Chưa có tuyến';
  }
}
function formatDistance(m){
  return m>=1000?(m/1000).toLocaleString('vi-VN',{maximumFractionDigits:1})+' km':Math.round(m)+' m';
}
function draw(){
  overlay.clearLayers();

  if(mode==='radius'&&sourcePoint){
    new Vietflex.Circle([sourcePoint.lat,sourcePoint.lon],{
      radius:+$('radius').value||5000,
      weight:2,
      fillOpacity:.06
    }).addTo(overlay);
    new Vietflex.Marker([sourcePoint.lat,sourcePoint.lon])
      .bindPopup('<strong>'+escapeHtml($('poiName').textContent)+'</strong><br>'+sourcePoint.lat.toFixed(7)+', '+sourcePoint.lon.toFixed(7))
      .addTo(overlay);
  }

  if(geometry)new Vietflex.GeoJSON(geometry,{style:{weight:2,fillOpacity:.08}}).addTo(overlay);

  if(mode!=='radius'){
    centers.forEach(p=>new Vietflex.CircleMarker([p.lat,p.lon],{radius:4,weight:1,fillOpacity:.8}).addTo(overlay));
  }

  const ls=overlay.getLayers();
  if(ls.length){
    const g=new Vietflex.FeatureGroup(ls),b=g.getBounds();
    if(b.isValid())map.fitBounds(b.pad(.12));
  }
}
function acceptGoogleUrl(){
  const raw=$('mapsUrl').value.trim();
  if(!raw){
    setStatus($('urlStatus'),'Hãy dán URL Google Maps.','warn');
    return false;
  }
  const p=parseGoogleMapPoint(raw);
  if(!p||!pointValid(p)){
    setStatus($('urlStatus'),'Không đọc được tọa độ từ URL. Hãy dùng link Google Maps đầy đủ có @lat,lon hoặc !3d…!4d….','error');
    return false;
  }

  sourcePoint={lat:p.lat,lon:p.lon};
  const name=googlePlaceName(raw);
  $('poiName').textContent=name;
  $('poiLat').textContent=p.lat.toFixed(7);
  $('poiLon').textContent=p.lon.toFixed(7);
  $('poiInfo').classList.remove('hidden');
  centers=[sourcePoint];
  geometry=null;
  setMode('radius');
  map.setView([p.lat,p.lon],14);

  const detail=p.source==='poi'
    ?'Đã đọc tọa độ chính xác của POI từ !3d/!4d.'
    :'Đã đọc tọa độ từ URL Google Maps.';
  setStatus($('urlStatus'),detail,'ok');
  updateSpatialSummary();
  draw();
  return true;
}

function hav(a,b){
  const R=6371.0088,r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function sampleLine(points,km){
  points=dedupe(points);km=Math.max(.25,+km||3);
  if(points.length<2)return points;
  const out=[points[0]];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],steps=Math.max(1,Math.ceil(hav(a,b)/km));
    for(let j=1;j<=steps;j++){
      const t=j/steps;
      out.push({lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t});
    }
  }
  return cap(dedupe(out));
}
function inRing(lon,lat,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
    const hit=((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-12)+xi);
    if(hit)inside=!inside;
  }
  return inside;
}
function inPoly(lon,lat,p){
  if(!p.length||!inRing(lon,lat,p[0]))return false;
  for(let i=1;i<p.length;i++)if(inRing(lon,lat,p[i]))return false;
  return true;
}
function inGeom(lon,lat,g){
  if(g.type==='Polygon')return inPoly(lon,lat,g.coordinates);
  if(g.type==='MultiPolygon')return g.coordinates.some(p=>inPoly(lon,lat,p));
  return false;
}
function bounds(g){
  let a=[Infinity,Infinity,-Infinity,-Infinity];
  (function visit(n){
    if(!Array.isArray(n))return;
    if(n.length>=2&&typeof n[0]==='number'){
      a=[Math.min(a[0],n[0]),Math.min(a[1],n[1]),Math.max(a[2],n[0]),Math.max(a[3],n[1])];
      return;
    }
    n.forEach(visit);
  })(g.coordinates);
  return a;
}
function samplePolygon(g,km){
  const b=bounds(g),mid=(b[1]+b[3])/2;
  const dy=Math.max(.005,(+km||5)/111.32);
  const dx=dy/Math.max(.2,Math.cos(mid*Math.PI/180));
  const out=[];
  for(let y=b[1]+dy/2;y<=b[3];y+=dy){
    for(let x=b[0]+dx/2;x<=b[2];x+=dx){
      if(inGeom(x,y,g))out.push({lat:y,lon:x});
      if(out.length>1200)break;
    }
    if(out.length>1200)break;
  }
  if(!out.length)out.push({lat:(b[1]+b[3])/2,lon:(b[0]+b[2])/2});
  return cap(out);
}
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

document.querySelectorAll('.tab').forEach(x=>x.addEventListener('click',()=>setMode(x.dataset.mode)));
$('parseUrl').onclick=acceptGoogleUrl;
$('mapsUrl').addEventListener('paste',()=>setTimeout(()=>{if($('mapsUrl').value.trim())acceptGoogleUrl();},0));
$('mapsUrl').addEventListener('change',()=>{if($('mapsUrl').value.trim())acceptGoogleUrl();});

$('radiusPreset').onchange=()=>{
  $('radius').value=$('radiusPreset').value;
  updateSpatialSummary();
  draw();
};
$('radius').oninput=()=>{
  updateSpatialSummary();
  draw();
};

$('suggestBoundary').onclick=async()=>{
  if(!sourcePoint){
    setStatus($('urlStatus'),'Hãy dán URL Google Maps trước.','warn');
    return;
  }
  $('boundaryStatus').textContent='Đang xác định địa giới từ vị trí POI…';
  try{
    const u='https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&addressdetails=1&accept-language=vi&lat='+encodeURIComponent(sourcePoint.lat)+'&lon='+encodeURIComponent(sourcePoint.lon);
    const r=await fetch(u,{headers:{'Accept':'application/json'}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json(),a=d.address||{};
    const q=a.suburb||a.quarter||a.city_district||a.town||a.city||a.county||a.state;
    if(!q)throw new Error('Không tìm thấy tên địa giới phù hợp');
    $('boundaryQuery').value=q+(a.state&&q!==a.state?', '+a.state:'');
    $('boundaryStatus').textContent='Đã gợi ý: '+$('boundaryQuery').value;
  }catch(e){
    $('boundaryStatus').textContent='Không gợi ý được địa giới: '+e.message;
  }
};

$('loadBoundary').onclick=async()=>{
  const q=$('boundaryQuery').value.trim();
  if(!q){$('boundaryStatus').textContent='Hãy nhập tên địa giới.';return;}
  $('boundaryStatus').textContent='Đang tìm địa giới…';
  try{
    const u='https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=5&countrycodes=vn&accept-language=vi&q='+encodeURIComponent(q);
    const r=await fetch(u,{headers:{'Accept':'application/geo+json,application/json'}});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    const f=(d.features||[]).find(x=>x.geometry&&(x.geometry.type==='Polygon'||x.geometry.type==='MultiPolygon'));
    if(!f)throw new Error('Không có polygon phù hợp');
    geometry=f.geometry;
    centers=samplePolygon(geometry,$('boundarySpacing').value);
    setMode('boundary');
    $('boundaryStatus').textContent=(f.properties&&f.properties.display_name)||'Đã nạp địa giới.';
    updateSpatialSummary();
    draw();
  }catch(e){
    $('boundaryStatus').textContent='Không nạp được địa giới: '+e.message;
  }
};

$('boundaryFile').onchange=e=>{
  const file=e.target.files&&e.target.files[0];
  if(!file)return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const o=JSON.parse(rd.result);
      const g=o.type==='FeatureCollection'?(o.features[0]&&o.features[0].geometry):(o.type==='Feature'?o.geometry:o);
      if(!g)throw new Error('Thiếu geometry');
      if(g.type!=='Polygon'&&g.type!=='MultiPolygon')throw new Error('Cần Polygon hoặc MultiPolygon');
      geometry=g;
      centers=samplePolygon(g,$('boundarySpacing').value);
      setMode('boundary');
      $('boundaryStatus').textContent='Đã nạp '+file.name;
      updateSpatialSummary();
      draw();
    }catch(err){
      $('boundaryStatus').textContent='Lỗi GeoJSON: '+err.message;
    }
  };
  rd.readAsText(file);
};

$('buildRoute').onclick=()=>{
  const pts=parsePoints($('routeInput').value);
  if(pts.length<2){
    setStatus($('jobStatus'),'Cần ít nhất 2 tọa độ để tạo tuyến.','warn');
    return;
  }
  geometry={type:'LineString',coordinates:pts.map(p=>[p.lon,p.lat])};
  centers=sampleLine(pts,$('routeSpacing').value);
  setMode('route');
  updateSpatialSummary();
  draw();
};

$('clearSpatial').onclick=()=>{
  sourcePoint=null;
  centers=[];
  geometry=null;
  $('mapsUrl').value='';
  $('poiInfo').classList.add('hidden');
  $('urlStatus').textContent='';
  $('boundaryStatus').textContent='';
  $('spatialSummary').textContent='Chưa có vị trí. Hãy dán URL Google Maps.';
  $('mapBadge').textContent='Chưa có vị trí';
  overlay.clearLayers();
  map.setView([16.2,106.2],6);
};

document.querySelectorAll('.chip').forEach(btn=>btn.addEventListener('click',()=>{
  const k=btn.dataset.keyword;
  const current=$('keywords').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!current.includes(k))current.push(k);
  $('keywords').value=current.join('\n');
}));


function buildPayload(){
  const qs=$('keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!qs.length)throw new Error('Hãy chọn hoặc nhập ít nhất một loại POI cần tìm.');

  let cs=[];
  let lat='',lon='';

  if(mode==='radius'){
    if(!sourcePoint)throw new Error('Hãy dán URL Google Maps và đọc vị trí trước.');
    cs=[sourcePoint];
    lat=String(sourcePoint.lat);
    lon=String(sourcePoint.lon);
  }else{
    cs=centers.slice();
    if(!cs.length)throw new Error(mode==='boundary'?'Chưa nạp địa giới.':'Chưa tạo tuyến.');
  }

  const poi=$('poiName').textContent&&$('poiName').textContent!=='Google Maps POI'?$('poiName').textContent:'POI';
  return {
    name:poi+' · '+qs.join(', ').slice(0,80),
    keywords:qs,
    centers:cs,
    geo_mode:mode,
    lang:$('lang').value.trim()||'vi',
    zoom:+$('zoom').value||15,
    lat:lat,
    lon:lon,
    fast_mode:$('fastMode').checked,
    radius:+$('radius').value||5000,
    depth:+$('depth').value||10,
    email:$('fetchEmail').checked,
    max_time:+$('maxTime').value||600,
    proxies:[]
  };
}

$('startJob').onclick=()=>{
  const msg='Chế độ thu thập chạy cục bộ trên PC. Tải repository về máy, chạy START_LOCAL_WINDOWS.bat, chọn thư mục lưu rồi sử dụng giao diện local.';
  setStatus($('jobStatus'),msg,'ok');
  window.open('https://github.com/xulytiengviet/google-maps-scraper','_blank','noopener');
};

setMode('radius');
})();