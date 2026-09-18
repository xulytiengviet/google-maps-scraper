(function(){
'use strict';

const $=id=>document.getElementById(id);
let mode='radius', sourcePoint=null, centers=[], geometry=null, results=[];
let placesReadyPromise=null;

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
const scopeOverlay=new Vietflex.LayerGroup().addTo(map);
const resultOverlay=new Vietflex.LayerGroup().addTo(map);

function status(msg,type){ $('jobStatus').textContent=msg||''; $('jobStatus').className='status'+(type?' '+type:''); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function validPoint(p){ return p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180; }
function dedupePoints(points){
  const seen=new Set(),out=[];
  (points||[]).forEach(p=>{
    if(!validPoint(p))return;
    const k=p.lat.toFixed(6)+','+p.lon.toFixed(6);
    if(!seen.has(k)){seen.add(k);out.push({lat:p.lat,lon:p.lon});}
  });
  return out;
}
function cap(points,n){ if(points.length<=n)return points; const out=[],step=points.length/n; for(let i=0;i<n;i++)out.push(points[Math.floor(i*step)]); return out; }
function googlePlaceName(text){
  try{
    const u=new URL(text),parts=u.pathname.split('/').filter(Boolean),i=parts.indexOf('place');
    if(i>=0&&parts[i+1])return decodeURIComponent(parts[i+1]).replace(/\+/g,' ').trim();
  }catch(_){}
  return 'Google Maps POI';
}
function parseGooglePoint(text){
  text=String(text||'').trim();
  if(!text)return null;
  let m=text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if(m)return {lat:+m[1],lon:+m[2],source:'poi'};
  m=text.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if(m)return {lat:+m[1],lon:+m[2],source:'viewport'};
  m=text.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if(m)return {lat:+m[1],lon:+m[2],source:'coords'};
  try{
    const u=new URL(text);
    for(const key of ['q','query','ll']){
      const v=u.searchParams.get(key);
      if(!v)continue;
      const q=v.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
      if(q)return {lat:+q[1],lon:+q[2],source:'query'};
    }
  }catch(_){}
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
    if(pts.length)return dedupePoints(pts);
  }catch(_){}
  text.split(/\r?\n|;/).forEach(line=>{const p=parseGooglePoint(line);if(p)pts.push(p);});
  return dedupePoints(pts);
}
function hav(a,b){
  const R=6371.0088,r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function sampleLine(points,km){
  points=dedupePoints(points);km=Math.max(.25,+km||3);
  if(points.length<2)return points;
  const out=[points[0]];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],steps=Math.max(1,Math.ceil(hav(a,b)/km));
    for(let j=1;j<=steps;j++){const t=j/steps;out.push({lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t});}
  }
  return cap(dedupePoints(out),30);
}
function sampleCircle(center,radiusM){
  const rkm=Math.max(.1,+radiusM/1000),step=Math.max(.8,Math.min(5,rkm/2||1));
  const degLat=step/111.32,degLon=degLat/Math.max(.25,Math.cos(center.lat*Math.PI/180)),out=[center];
  for(let y=center.lat-rkm/111.32;y<=center.lat+rkm/111.32;y+=degLat){
    for(let x=center.lon-rkm/(111.32*Math.max(.25,Math.cos(center.lat*Math.PI/180)));x<=center.lon+rkm/(111.32*Math.max(.25,Math.cos(center.lat*Math.PI/180)));x+=degLon){
      const p={lat:y,lon:x}; if(hav(center,p)<=rkm)out.push(p);
    }
  }
  return cap(dedupePoints(out),25);
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
function inPoly(lon,lat,p){ if(!p.length||!inRing(lon,lat,p[0]))return false; for(let i=1;i<p.length;i++)if(inRing(lon,lat,p[i]))return false; return true; }
function inGeom(lon,lat,g){ return g.type==='Polygon'?inPoly(lon,lat,g.coordinates):g.type==='MultiPolygon'?g.coordinates.some(p=>inPoly(lon,lat,p)):false; }
function bounds(g){
  let a=[Infinity,Infinity,-Infinity,-Infinity];
  (function visit(n){
    if(!Array.isArray(n))return;
    if(n.length>=2&&typeof n[0]==='number'){a=[Math.min(a[0],n[0]),Math.min(a[1],n[1]),Math.max(a[2],n[0]),Math.max(a[3],n[1])];return;}
    n.forEach(visit);
  })(g.coordinates); return a;
}
function samplePolygon(g,km){
  const b=bounds(g),mid=(b[1]+b[3])/2,dy=Math.max(.005,(+km||5)/111.32),dx=dy/Math.max(.2,Math.cos(mid*Math.PI/180)),out=[];
  for(let y=b[1]+dy/2;y<=b[3];y+=dy){
    for(let x=b[0]+dx/2;x<=b[2];x+=dx){ if(inGeom(x,y,g))out.push({lat:y,lon:x}); if(out.length>150)break; }
    if(out.length>150)break;
  }
  if(!out.length)out.push({lat:(b[1]+b[3])/2,lon:(b[0]+b[2])/2});
  return cap(out,30);
}

function setMode(m){
  mode=m;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.mode===m));
  document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('active',x.dataset.panel===m));
  if(m==='radius'){geometry=null;centers=sourcePoint?sampleCircle(sourcePoint,+$('radius').value||5000):[];}
  updateSummary(); drawScope();
}
function updateSummary(){
  if(mode==='radius'){
    if(!sourcePoint){$('spatialSummary').textContent='Chưa có vị trí.';$('mapBadge').textContent='Chưa có vị trí';return;}
    const r=+$('radius').value||5000;
    $('spatialSummary').textContent='Tâm '+sourcePoint.lat.toFixed(6)+', '+sourcePoint.lon.toFixed(6)+' · '+(r>=1000?(r/1000)+' km':r+' m');
    $('mapBadge').textContent='Bán kính '+(r>=1000?(r/1000)+' km':r+' m');
  }else if(mode==='boundary'){
    $('spatialSummary').textContent=centers.length?centers.length+' tâm tìm kiếm trong địa giới':'Chưa nạp địa giới.';
    $('mapBadge').textContent=centers.length?'Địa giới · '+centers.length+' tâm':'Chưa có địa giới';
  }else{
    $('spatialSummary').textContent=centers.length?centers.length+' tâm dọc tuyến':'Chưa tạo tuyến.';
    $('mapBadge').textContent=centers.length?'Tuyến · '+centers.length+' tâm':'Chưa có tuyến';
  }
}
function drawScope(){
  scopeOverlay.clearLayers();
  if(mode==='radius'&&sourcePoint){
    new Vietflex.Circle([sourcePoint.lat,sourcePoint.lon],{radius:+$('radius').value||5000,weight:2,fillOpacity:.05}).addTo(scopeOverlay);
    new Vietflex.Marker([sourcePoint.lat,sourcePoint.lon]).bindPopup('<strong>'+esc($('poiName').textContent)+'</strong>').addTo(scopeOverlay);
  }
  if(geometry)new Vietflex.GeoJSON(geometry,{style:{weight:2,fillOpacity:.06}}).addTo(scopeOverlay);
  if(mode!=='radius')centers.forEach(p=>new Vietflex.CircleMarker([p.lat,p.lon],{radius:3,weight:1,fillOpacity:.6}).addTo(scopeOverlay));
  const layers=scopeOverlay.getLayers();
  if(layers.length){const g=new Vietflex.FeatureGroup(layers),b=g.getBounds();if(b.isValid())map.fitBounds(b.pad(.12));}
}
function acceptURL(){
  const raw=$('mapsUrl').value.trim(),p=parseGooglePoint(raw);
  if(!raw){$('urlStatus').textContent='Hãy dán URL Google Maps.';return false;}
  if(!p||!validPoint(p)){$('urlStatus').textContent='Không đọc được tọa độ từ URL.';return false;}
  sourcePoint={lat:p.lat,lon:p.lon};
  $('poiName').textContent=googlePlaceName(raw);
  $('poiLat').textContent=p.lat.toFixed(7);$('poiLon').textContent=p.lon.toFixed(7);
  $('poiInfo').classList.remove('hidden');$('urlStatus').textContent='Đã đọc vị trí POI.';
  setMode('radius');map.setView([p.lat,p.lon],14);return true;
}

async function ensurePlaces(){
  if(window.google&&google.maps&&google.maps.importLibrary)return true;
  if(placesReadyPromise)return placesReadyPromise;
  const key=((window.POI_BROWSER_CONFIG||{}).googleMapsApiKey||'').trim();
  if(!key)throw new Error('Chủ website chưa cấu hình Google Maps JavaScript API / Places API key trong config.js.');
  placesReadyPromise=new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&v=weekly&loading=async';
    s.async=true;s.defer=true;
    s.onload=()=>resolve(true);
    s.onerror=()=>reject(new Error('Không tải được Google Maps JavaScript API.'));
    document.head.appendChild(s);
  });
  return placesReadyPromise;
}
function placeToRow(place,keyword){
  const loc=place.location;
  const lat=loc?Number(typeof loc.lat==='function'?loc.lat():loc.lat):null;
  const lon=loc?Number(typeof loc.lng==='function'?loc.lng():loc.lng):null;
  return {
    id:place.id||'',
    keyword,
    name:place.displayName||'',
    type:place.primaryTypeDisplayName||place.primaryType||(place.types||[])[0]||'',
    address:place.formattedAddress||'',
    phone:place.internationalPhoneNumber||place.nationalPhoneNumber||'',
    website:place.websiteURI||'',
    rating:place.rating??'',
    reviews:place.userRatingCount??'',
    latitude:lat,
    longitude:lon,
    google_maps_url:place.googleMapsURI||'',
    business_status:place.businessStatus||''
  };
}
function withinScope(r){
  const p={lat:r.latitude,lon:r.longitude};
  if(!validPoint(p))return false;
  if(mode==='radius')return sourcePoint&&hav(sourcePoint,p)<=((+$('radius').value||5000)/1000);
  if(mode==='boundary')return geometry?inGeom(p.lon,p.lat,geometry):true;
  return true;
}
async function searchOne(Place,keyword,center){
  const req={
    textQuery:keyword,
    fields:['id','displayName','location','formattedAddress','googleMapsURI','nationalPhoneNumber','internationalPhoneNumber','websiteURI','rating','userRatingCount','primaryType','primaryTypeDisplayName','types','businessStatus'],
    locationBias:{lat:center.lat,lng:center.lon},
    language:'vi',
    region:'vn',
    maxResultCount:20
  };
  const {places}=await Place.searchByText(req);
  return (places||[]).map(p=>placeToRow(p,keyword));
}
async function runSearch(){
  const keywords=$('keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!keywords.length)throw new Error('Hãy nhập ít nhất một từ khóa POI.');
  if(mode==='radius'){
    if(!sourcePoint)throw new Error('Hãy dán URL Google Maps trước.');
    centers=sampleCircle(sourcePoint,+$('radius').value||5000);
  }else if(!centers.length){
    throw new Error(mode==='boundary'?'Hãy nạp địa giới trước.':'Hãy tạo tuyến trước.');
  }

  await ensurePlaces();
  const {Place}=await google.maps.importLibrary('places');
  const all=[],searchCenters=cap(centers,30);
  let done=0,total=keywords.length*searchCenters.length;
  for(const keyword of keywords){
    for(const center of searchCenters){
      done++;status('Đang tìm '+keyword+' · '+done+'/'+total+'…','');
      try{ all.push(...await searchOne(Place,keyword,center)); }
      catch(e){ console.warn('Place search failed',keyword,center,e); }
    }
  }
  const byId=new Map();
  all.forEach(r=>{const key=r.id||[r.name,r.latitude,r.longitude].join('|');if(!byId.has(key)&&withinScope(r))byId.set(key,r);});
  results=[...byId.values()];
  renderResults();
}
function renderResults(){
  resultOverlay.clearLayers();
  $('resultSummary').textContent=results.length?results.length+' POI':'Không có POI phù hợp.';
  $('resultsBody').innerHTML=results.length?results.map(r=>'<tr>'+
    '<td>'+(r.google_maps_url?'<a href="'+esc(r.google_maps_url)+'" target="_blank" rel="noopener">'+esc(r.name)+'</a>':esc(r.name))+'</td>'+
    '<td>'+esc(r.type)+'</td><td>'+esc(r.address)+'</td><td>'+esc(r.phone)+'</td>'+
    '<td>'+(r.website?'<a href="'+esc(r.website)+'" target="_blank" rel="noopener">Website</a>':'')+'</td>'+
    '<td>'+esc(r.rating)+'</td><td>'+esc(r.reviews)+'</td><td>'+Number(r.latitude).toFixed(6)+'</td><td>'+Number(r.longitude).toFixed(6)+'</td></tr>').join(''):
    '<tr><td colspan="9" class="empty">Không có dữ liệu.</td></tr>';
  results.forEach(r=>{
    if(Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)){
      new Vietflex.CircleMarker([r.latitude,r.longitude],{radius:5,weight:1,fillOpacity:.85})
        .bindPopup('<strong>'+esc(r.name)+'</strong><br>'+esc(r.address)).addTo(resultOverlay);
    }
  });
  ['exportCsv','exportJson','exportGeoJson'].forEach(id=>$(id).disabled=!results.length);
  const ls=resultOverlay.getLayers();if(ls.length){const g=new Vietflex.FeatureGroup(ls),b=g.getBounds();if(b.isValid())map.fitBounds(b.pad(.12));}
  status(results.length?'Hoàn tất: '+results.length+' POI. Có thể tải CSV / JSON / GeoJSON.':'Hoàn tất nhưng không có kết quả.','ok');
}
function downloadBlob(filename,mime,text){
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:mime}));
  a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function csvEscape(v){const s=String(v==null?'':v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function exportCSV(){
  const headers=['name','type','address','phone','website','rating','reviews','latitude','longitude','google_maps_url','keyword','id','business_status'];
  const rows=[headers.join(','),...results.map(r=>headers.map(h=>csvEscape(r[h])).join(','))];
  downloadBlob('poi-results.csv','text/csv;charset=utf-8','\uFEFF'+rows.join('\n'));
}
function exportJSON(){downloadBlob('poi-results.json','application/json;charset=utf-8',JSON.stringify(results,null,2));}
function exportGeoJSON(){
  const fc={type:'FeatureCollection',features:results.filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude)).map(r=>({
    type:'Feature',geometry:{type:'Point',coordinates:[r.longitude,r.latitude]},properties:Object.fromEntries(Object.entries(r).filter(([k])=>!['latitude','longitude'].includes(k)))
  }))};
  downloadBlob('poi-results.geojson','application/geo+json;charset=utf-8',JSON.stringify(fc,null,2));
}

document.querySelectorAll('.tab').forEach(x=>x.addEventListener('click',()=>setMode(x.dataset.mode)));
document.querySelectorAll('.chip').forEach(btn=>btn.addEventListener('click',()=>{
  const rows=$('keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!rows.includes(btn.dataset.keyword))rows.push(btn.dataset.keyword);$('keywords').value=rows.join('\n');
}));
$('parseUrl').onclick=acceptURL;
$('mapsUrl').addEventListener('paste',()=>setTimeout(()=>{if($('mapsUrl').value.trim())acceptURL();},0));
$('radiusPreset').onchange=()=>{$('radius').value=$('radiusPreset').value;if(sourcePoint)centers=sampleCircle(sourcePoint,+$('radius').value||5000);updateSummary();drawScope();};
$('radius').oninput=()=>{if(sourcePoint)centers=sampleCircle(sourcePoint,+$('radius').value||5000);updateSummary();drawScope();};

$('suggestBoundary').onclick=async()=>{
  if(!sourcePoint){$('boundaryStatus').textContent='Hãy dán URL Google Maps trước.';return;}
  $('boundaryStatus').textContent='Đang xác định địa giới…';
  try{
    const u='https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&addressdetails=1&accept-language=vi&lat='+sourcePoint.lat+'&lon='+sourcePoint.lon;
    const r=await fetch(u),d=await r.json(),a=d.address||{};
    const q=a.suburb||a.quarter||a.city_district||a.town||a.city||a.county||a.state;
    if(!q)throw new Error('Không tìm thấy địa giới');
    $('boundaryQuery').value=q+(a.state&&q!==a.state?', '+a.state:'');$('boundaryStatus').textContent='Đã gợi ý: '+$('boundaryQuery').value;
  }catch(e){$('boundaryStatus').textContent='Không gợi ý được: '+e.message;}
};
$('loadBoundary').onclick=async()=>{
  const q=$('boundaryQuery').value.trim();if(!q){$('boundaryStatus').textContent='Hãy nhập tên địa giới.';return;}
  $('boundaryStatus').textContent='Đang tìm địa giới…';
  try{
    const u='https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=5&countrycodes=vn&accept-language=vi&q='+encodeURIComponent(q);
    const r=await fetch(u),d=await r.json(),f=(d.features||[]).find(x=>x.geometry&&(x.geometry.type==='Polygon'||x.geometry.type==='MultiPolygon'));
    if(!f)throw new Error('Không có polygon phù hợp');
    geometry=f.geometry;centers=samplePolygon(geometry,$('boundarySpacing').value);setMode('boundary');
    $('boundaryStatus').textContent=(f.properties&&f.properties.display_name)||'Đã nạp địa giới.';
  }catch(e){$('boundaryStatus').textContent='Không nạp được địa giới: '+e.message;}
};
$('boundaryFile').onchange=e=>{
  const file=e.target.files&&e.target.files[0];if(!file)return;
  const rd=new FileReader();rd.onload=()=>{
    try{
      const o=JSON.parse(rd.result),g=o.type==='FeatureCollection'?(o.features[0]&&o.features[0].geometry):(o.type==='Feature'?o.geometry:o);
      if(!g||(g.type!=='Polygon'&&g.type!=='MultiPolygon'))throw new Error('Cần Polygon hoặc MultiPolygon');
      geometry=g;centers=samplePolygon(g,$('boundarySpacing').value);setMode('boundary');$('boundaryStatus').textContent='Đã nạp '+file.name;
    }catch(err){$('boundaryStatus').textContent='Lỗi GeoJSON: '+err.message;}
  };rd.readAsText(file);
};
$('buildRoute').onclick=()=>{
  const pts=parsePoints($('routeInput').value);if(pts.length<2){status('Cần ít nhất 2 tọa độ.','warn');return;}
  geometry={type:'LineString',coordinates:pts.map(p=>[p.lon,p.lat])};centers=sampleLine(pts,$('routeSpacing').value);setMode('route');
};
$('clearSpatial').onclick=()=>{
  sourcePoint=null;centers=[];geometry=null;results=[];$('mapsUrl').value='';$('poiInfo').classList.add('hidden');
  $('urlStatus').textContent='';$('boundaryStatus').textContent='';scopeOverlay.clearLayers();resultOverlay.clearLayers();
  map.setView([16.2,106.2],6);updateSummary();renderResults();
};
$('startJob').onclick=async()=>{
  $('startJob').disabled=true;results=[];renderResults();
  try{await runSearch();}catch(e){status(e.message,'error');}finally{$('startJob').disabled=false;}
};
$('exportCsv').onclick=exportCSV;
$('exportJson').onclick=exportJSON;
$('exportGeoJson').onclick=exportGeoJSON;

setMode('radius');
})();