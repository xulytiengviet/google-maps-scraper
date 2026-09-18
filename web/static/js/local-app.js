(function(){
'use strict';

const $=id=>document.getElementById(id);
let mode='radius', sourcePoint=null, centers=[], geometry=null;

if(!window.Vietflex){
  document.getElementById('job-status').textContent='Không tải được Vietflex Map.';
  return;
}

const map=Vietflex.vietflexMap('search-map',{
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

function validPoint(p){return p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180}
function uniquePoints(points){
  const seen=new Set(),out=[];
  (points||[]).forEach(p=>{
    if(!validPoint(p))return;
    const k=p.lat.toFixed(6)+','+p.lon.toFixed(6);
    if(!seen.has(k)){seen.add(k);out.push({lat:p.lat,lon:p.lon});}
  });
  return out;
}
function cap(points,n=250){
  if(points.length<=n)return points;
  const out=[],step=points.length/n;
  for(let i=0;i<n;i++)out.push(points[Math.floor(i*step)]);
  return out;
}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function setText(id,text){$(id).textContent=text||''}
function googlePlaceName(text){
  try{
    const u=new URL(text);
    const parts=u.pathname.split('/').filter(Boolean);
    const i=parts.indexOf('place');
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
    if(pts.length)return uniquePoints(pts);
  }catch(_){}
  text.split(/\r?\n|;/).forEach(line=>{const p=parseGooglePoint(line);if(p)pts.push(p);});
  return uniquePoints(pts);
}
function formatDistance(m){return m>=1000?(m/1000).toLocaleString('vi-VN',{maximumFractionDigits:1})+' km':Math.round(m)+' m'}
function setMode(m){
  mode=m;
  document.querySelectorAll('.mode-tab').forEach(x=>x.classList.toggle('active',x.dataset.mode===m));
  document.querySelectorAll('.mode-panel').forEach(x=>x.classList.toggle('active',x.dataset.modePanel===m));
  if(m==='radius'){geometry=null;centers=sourcePoint?[sourcePoint]:[];}
  updateSummary();draw();
}
function updateSummary(){
  if(mode==='radius'){
    if(!sourcePoint){setText('spatial-summary','Chưa có vị trí.');setText('map-badge','Chưa có vị trí');return;}
    const r=+$('radius').value||5000;
    setText('spatial-summary','Tâm '+sourcePoint.lat.toFixed(6)+', '+sourcePoint.lon.toFixed(6)+' · '+formatDistance(r));
    setText('map-badge','Bán kính '+formatDistance(r));
  }else if(mode==='boundary'){
    setText('spatial-summary',centers.length?centers.length+' điểm lấy mẫu trong địa giới':'Chưa nạp địa giới.');
    setText('map-badge',centers.length?'Địa giới · '+centers.length+' điểm':'Chưa có địa giới');
  }else{
    setText('spatial-summary',centers.length?centers.length+' điểm lấy mẫu dọc tuyến':'Chưa tạo tuyến.');
    setText('map-badge',centers.length?'Tuyến · '+centers.length+' điểm':'Chưa có tuyến');
  }
}
function draw(){
  overlay.clearLayers();
  if(mode==='radius'&&sourcePoint){
    new Vietflex.Circle([sourcePoint.lat,sourcePoint.lon],{radius:+$('radius').value||5000,weight:2,fillOpacity:.06}).addTo(overlay);
    new Vietflex.Marker([sourcePoint.lat,sourcePoint.lon]).bindPopup('<strong>'+esc($('poi-name').textContent)+'</strong>').addTo(overlay);
  }
  if(geometry)new Vietflex.GeoJSON(geometry,{style:{weight:2,fillOpacity:.08}}).addTo(overlay);
  if(mode!=='radius')centers.forEach(p=>new Vietflex.CircleMarker([p.lat,p.lon],{radius:4,weight:1,fillOpacity:.8}).addTo(overlay));
  const layers=overlay.getLayers();
  if(layers.length){
    const group=new Vietflex.FeatureGroup(layers),b=group.getBounds();
    if(b.isValid())map.fitBounds(b.pad(.12));
  }
}
function acceptURL(){
  const raw=$('maps_url').value.trim();
  if(!raw){setText('url-status','Hãy dán URL Google Maps.');return false;}
  const p=parseGooglePoint(raw);
  if(!p||!validPoint(p)){setText('url-status','Không đọc được tọa độ. Hãy dùng URL Google Maps đầy đủ có @lat,lon hoặc !3d…!4d….');return false;}
  sourcePoint={lat:p.lat,lon:p.lon};
  $('poi-name').textContent=googlePlaceName(raw);
  $('poi-coords').textContent=p.lat.toFixed(7)+', '+p.lon.toFixed(7);
  $('poi-info').hidden=false;
  centers=[sourcePoint];geometry=null;setMode('radius');map.setView([p.lat,p.lon],14);
  setText('url-status',p.source==='poi'?'Đã đọc tọa độ chính xác của POI.':'Đã đọc tọa độ từ URL.');
  return true;
}
function hav(a,b){
  const R=6371.0088,r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r;
  const h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function sampleLine(points,km){
  points=uniquePoints(points);km=Math.max(.25,+km||3);
  if(points.length<2)return points;
  const out=[points[0]];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],steps=Math.max(1,Math.ceil(hav(a,b)/km));
    for(let j=1;j<=steps;j++){const t=j/steps;out.push({lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t});}
  }
  return cap(uniquePoints(out));
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
function inGeom(lon,lat,g){return g.type==='Polygon'?inPoly(lon,lat,g.coordinates):g.type==='MultiPolygon'?g.coordinates.some(p=>inPoly(lon,lat,p)):false}
function bounds(g){
  let a=[Infinity,Infinity,-Infinity,-Infinity];
  (function visit(n){
    if(!Array.isArray(n))return;
    if(n.length>=2&&typeof n[0]==='number'){a=[Math.min(a[0],n[0]),Math.min(a[1],n[1]),Math.max(a[2],n[0]),Math.max(a[3],n[1])];return;}
    n.forEach(visit);
  })(g.coordinates);
  return a;
}
function samplePolygon(g,km){
  const b=bounds(g),mid=(b[1]+b[3])/2,dy=Math.max(.005,(+km||5)/111.32),dx=dy/Math.max(.2,Math.cos(mid*Math.PI/180)),out=[];
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

document.querySelectorAll('.mode-tab').forEach(x=>x.addEventListener('click',()=>setMode(x.dataset.mode)));
$('parse-url').onclick=acceptURL;
$('maps_url').addEventListener('paste',()=>setTimeout(()=>{if($('maps_url').value.trim())acceptURL();},0));
$('radius_preset').onchange=()=>{$('radius').value=$('radius_preset').value;updateSummary();draw();};
$('radius').oninput=()=>{updateSummary();draw();};

$('suggest-boundary').onclick=async()=>{
  if(!sourcePoint){setText('boundary-status','Hãy dán URL Google Maps trước.');return;}
  setText('boundary-status','Đang xác định địa giới từ POI…');
  try{
    const u='https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&addressdetails=1&accept-language=vi&lat='+sourcePoint.lat+'&lon='+sourcePoint.lon;
    const r=await fetch(u),d=await r.json(),a=d.address||{};
    const q=a.suburb||a.quarter||a.city_district||a.town||a.city||a.county||a.state;
    if(!q)throw new Error('Không tìm thấy địa giới');
    $('boundary_query').value=q+(a.state&&q!==a.state?', '+a.state:'');
    setText('boundary-status','Đã gợi ý: '+$('boundary_query').value);
  }catch(e){setText('boundary-status','Không gợi ý được: '+e.message);}
};
$('load-boundary').onclick=async()=>{
  const q=$('boundary_query').value.trim();
  if(!q){setText('boundary-status','Hãy nhập tên địa giới.');return;}
  setText('boundary-status','Đang tìm địa giới…');
  try{
    const u='https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=5&countrycodes=vn&accept-language=vi&q='+encodeURIComponent(q);
    const r=await fetch(u),d=await r.json(),f=(d.features||[]).find(x=>x.geometry&&(x.geometry.type==='Polygon'||x.geometry.type==='MultiPolygon'));
    if(!f)throw new Error('Không có polygon phù hợp');
    geometry=f.geometry;centers=samplePolygon(geometry,$('boundary_spacing').value);setMode('boundary');
    setText('boundary-status',(f.properties&&f.properties.display_name)||'Đã nạp địa giới.');
  }catch(e){setText('boundary-status','Không nạp được địa giới: '+e.message);}
};
$('boundary_file').onchange=e=>{
  const file=e.target.files&&e.target.files[0];if(!file)return;
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      const o=JSON.parse(rd.result),g=o.type==='FeatureCollection'?(o.features[0]&&o.features[0].geometry):(o.type==='Feature'?o.geometry:o);
      if(!g||(g.type!=='Polygon'&&g.type!=='MultiPolygon'))throw new Error('Cần Polygon hoặc MultiPolygon');
      geometry=g;centers=samplePolygon(g,$('boundary_spacing').value);setMode('boundary');setText('boundary-status','Đã nạp '+file.name);
    }catch(err){setText('boundary-status','Lỗi GeoJSON: '+err.message);}
  };
  rd.readAsText(file);
};
$('build-route').onclick=()=>{
  const pts=parsePoints($('route_input').value);
  if(pts.length<2){setText('job-status','Cần ít nhất 2 tọa độ.');return;}
  geometry={type:'LineString',coordinates:pts.map(p=>[p.lon,p.lat])};
  centers=sampleLine(pts,$('route_spacing').value);setMode('route');
};
$('clear-spatial').onclick=()=>{
  sourcePoint=null;centers=[];geometry=null;$('maps_url').value='';$('poi-info').hidden=true;
  setText('url-status','');setText('boundary-status','');overlay.clearLayers();map.setView([16.2,106.2],6);updateSummary();
};

document.querySelectorAll('.local-chips button').forEach(btn=>btn.addEventListener('click',()=>{
  const rows=$('keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!rows.includes(btn.dataset.keyword))rows.push(btn.dataset.keyword);
  $('keywords').value=rows.join('\n');
}));

function buildPayload(){
  const keywords=$('keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!keywords.length)throw new Error('Hãy nhập ít nhất một loại POI cần tìm.');
  let cs=[],lat='',lon='';
  if(mode==='radius'){
    if(!sourcePoint)throw new Error('Hãy dán URL Google Maps trước.');
    cs=[sourcePoint];lat=String(sourcePoint.lat);lon=String(sourcePoint.lon);
  }else{
    cs=centers.slice();
    if(!cs.length)throw new Error(mode==='boundary'?'Chưa nạp địa giới.':'Chưa tạo tuyến.');
  }
  return {
    Name:($('poi-name').textContent||'POI')+' · '+keywords.join(', ').slice(0,80),
    keywords,centers:cs,geo_mode:mode,lang:$('lang').value.trim()||'vi',
    zoom:+$('zoom').value||15,lat,lon,fast_mode:$('fast_mode').checked,
    radius:+$('radius').value||5000,depth:+$('depth').value||10,email:$('email').checked,
    max_time:+$('max_time').value||600,proxies:[]
  };
}
$('start-job').onclick=async()=>{
  try{
    const payload=buildPayload();
    setText('job-status','Đang tạo tác vụ…');
    const r=await fetch('/api/v1/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.message||('HTTP '+r.status));
    setText('job-status','Đã tạo tác vụ. CSV / JSON / GeoJSON sẽ tự lưu khi hoàn tất.');
    await loadJobs();
  }catch(e){setText('job-status',e.message);}
};

async function loadJobs(){
  try{
    const r=await fetch('/api/v1/jobs');
    if(!r.ok)throw new Error('HTTP '+r.status);
    const raw=await r.json(),jobs=Array.isArray(raw)?raw:(raw.jobs||[]);
    if(!jobs.length){$('local-jobs').innerHTML='<tr><td colspan="5">Chưa có tác vụ.</td></tr>';return;}
    $('local-jobs').innerHTML=jobs.slice(0,50).map(j=>{
      const id=esc(j.ID||j.id),name=esc(j.Name||j.name||'POI search'),st=esc(j.Status||j.status||'unknown');
      const enabled=st==='ok';
      const a=(fmt,label)=>enabled?'<a class="export-button" href="/api/v1/jobs/'+id+'/export?format='+fmt+'">'+label+'</a>':'—';
      return '<tr><td>'+name+'</td><td><span class="status-indicator status-'+st+'">'+st+'</span></td><td>'+a('csv','CSV')+'</td><td>'+a('json','JSON')+'</td><td>'+a('geojson','GeoJSON')+'</td></tr>';
    }).join('');
  }catch(e){$('local-jobs').innerHTML='<tr><td colspan="5">Lỗi: '+esc(e.message)+'</td></tr>';}
}
$('refresh-jobs').onclick=loadJobs;
setInterval(loadJobs,4000);
setMode('radius');
loadJobs();
})();