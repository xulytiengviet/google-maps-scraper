(function(){
'use strict';

const $=id=>document.getElementById(id);
let mode='text', centers=[], geometry=null;
const map=L.map('map').setView([16.2,106.2],6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
const overlay=L.layerGroup().addTo(map);

function apiBase(){return ($('apiBase').value||localStorage.getItem('gmapsApiBase')||'').trim().replace(/\/$/,'');}
function setStatus(el,msg,type){el.textContent=msg||'';el.className='status'+(type?' '+type:'');}
function pointValid(p){return p&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&p.lat>=-90&&p.lat<=90&&p.lon>=-180&&p.lon<=180}
function dedupe(points){const s=new Set(),out=[];points.forEach(p=>{if(!pointValid(p))return;const k=p.lat.toFixed(6)+','+p.lon.toFixed(6);if(!s.has(k)){s.add(k);out.push({lat:p.lat,lon:p.lon});}});return out}
function cap(points,n=250){if(points.length<=n)return points;const out=[],step=points.length/n;for(let i=0;i<n;i++)out.push(points[Math.floor(i*step)]);return out}
function setCenters(points,label){centers=cap(dedupe(points));$('spatialSummary').textContent=label||(!centers.length?'Chưa chọn phạm vi không gian.':centers.length+' điểm tìm kiếm');draw()}
function draw(){overlay.clearLayers();if(geometry)L.geoJSON(geometry,{style:{weight:2,fillOpacity:.08}}).addTo(overlay);centers.forEach(p=>L.circleMarker([p.lat,p.lon],{radius:4,weight:1,fillOpacity:.8}).addTo(overlay));const ls=overlay.getLayers();if(ls.length){const g=L.featureGroup(ls),b=g.getBounds();if(b.isValid())map.fitBounds(b.pad(.15));}}
function setMode(m){mode=m;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.mode===m));document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('active',x.dataset.panel===m));if(m==='text'){geometry=null;setCenters([],'Tìm theo khu vực mô tả bằng chữ.');}}
document.querySelectorAll('.tab').forEach(x=>x.addEventListener('click',()=>setMode(x.dataset.mode)));

function parsePoints(text){
 text=String(text||'').trim();if(!text)return[];
 let pts=[];
 try{
  const o=JSON.parse(text),g=o.type==='Feature'?o.geometry:o;
  if(g&&g.type==='Point')pts.push({lat:+g.coordinates[1],lon:+g.coordinates[0]});
  if(g&&g.type==='LineString')g.coordinates.forEach(c=>pts.push({lat:+c[1],lon:+c[0]}));
  if(pts.length)return dedupe(pts);
 }catch(_){}
 let m,re=/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g;while((m=re.exec(text)))pts.push({lat:+m[1],lon:+m[2]});
 re=/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;while((m=re.exec(text)))pts.push({lat:+m[1],lon:+m[2]});
 if(!pts.length)text.split(/\r?\n|;/).forEach(line=>{const a=line.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);if(a)pts.push({lat:+a[1],lon:+a[2]});});
 return dedupe(pts);
}
function hav(a,b){const R=6371.0088,r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlon=(b.lon-a.lon)*r,h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlon/2)**2;return 2*R*Math.asin(Math.sqrt(h));}
function sampleLine(points,km){points=dedupe(points);km=Math.max(.25,+km||3);if(points.length<2)return points;const out=[points[0]];for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1],steps=Math.max(1,Math.ceil(hav(a,b)/km));for(let j=1;j<=steps;j++){const t=j/steps;out.push({lat:a.lat+(b.lat-a.lat)*t,lon:a.lon+(b.lon-a.lon)*t});}}return cap(dedupe(out));}
function inRing(lon,lat,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];const hit=((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/((yj-yi)||1e-12)+xi);if(hit)inside=!inside;}return inside}
function inPoly(lon,lat,p){if(!p.length||!inRing(lon,lat,p[0]))return false;for(let i=1;i<p.length;i++)if(inRing(lon,lat,p[i]))return false;return true}
function inGeom(lon,lat,g){if(g.type==='Polygon')return inPoly(lon,lat,g.coordinates);if(g.type==='MultiPolygon')return g.coordinates.some(p=>inPoly(lon,lat,p));return false}
function bounds(g){let a=[Infinity,Infinity,-Infinity,-Infinity];(function visit(n){if(!Array.isArray(n))return;if(n.length>=2&&typeof n[0]==='number'){a=[Math.min(a[0],n[0]),Math.min(a[1],n[1]),Math.max(a[2],n[0]),Math.max(a[3],n[1])];return;}n.forEach(visit)})(g.coordinates);return a}
function samplePolygon(g,km){const b=bounds(g),mid=(b[1]+b[3])/2,dy=Math.max(.005,(+km||5)/111.32),dx=dy/Math.max(.2,Math.cos(mid*Math.PI/180)),out=[];for(let y=b[1]+dy/2;y<=b[3];y+=dy){for(let x=b[0]+dx/2;x<=b[2];x+=dx){if(inGeom(x,y,g))out.push({lat:y,lon:x});if(out.length>1200)break}if(out.length>1200)break}if(!out.length)out.push({lat:(b[1]+b[3])/2,lon:(b[0]+b[2])/2});return cap(out)}

$('parseLocation').onclick=()=>{const p=parsePoints($('mapsLocation').value)[0];if(!p){$('spatialSummary').textContent='Không đọc được tọa độ.';return}$('lat').value=p.lat.toFixed(7);$('lon').value=p.lon.toFixed(7);geometry=null;setCenters([p],'Tâm '+p.lat.toFixed(6)+', '+p.lon.toFixed(6)+' · bán kính '+$('radius').value+' m');map.setView([p.lat,p.lon],13)};
map.on('click',e=>{if(mode!=='radius')return;$('lat').value=e.latlng.lat.toFixed(7);$('lon').value=e.latlng.lng.toFixed(7);geometry=null;setCenters([{lat:e.latlng.lat,lon:e.latlng.lng}],'Tâm được chọn trên bản đồ');});
$('buildRoute').onclick=()=>{const pts=parsePoints($('routeInput').value);if(pts.length<2){$('spatialSummary').textContent='Cần ít nhất 2 tọa độ.';return}geometry={type:'LineString',coordinates:pts.map(p=>[p.lon,p.lat])};const s=sampleLine(pts,$('routeSpacing').value);setCenters(s,s.length+' điểm lấy mẫu dọc tuyến')};
$('loadBoundary').onclick=async()=>{const q=$('boundaryQuery').value.trim();if(!q){$('boundaryStatus').textContent='Hãy nhập tên địa giới.';return}$('boundaryStatus').textContent='Đang tìm OSM/Nominatim…';try{const u='https://nominatim.openstreetmap.org/search?format=geojson&polygon_geojson=1&limit=5&countrycodes=vn&accept-language=vi&q='+encodeURIComponent(q),r=await fetch(u),d=await r.json(),f=(d.features||[]).find(x=>x.geometry&&(x.geometry.type==='Polygon'||x.geometry.type==='MultiPolygon'));if(!f)throw new Error('Không có polygon phù hợp');geometry=f.geometry;const s=samplePolygon(geometry,$('boundarySpacing').value);setCenters(s,s.length+' điểm lấy mẫu trong địa giới');$('boundaryStatus').textContent=(f.properties&&f.properties.display_name)||'Đã nạp địa giới.';}catch(e){$('boundaryStatus').textContent='Không nạp được: '+e.message}};
$('boundaryFile').onchange=e=>{const file=e.target.files&&e.target.files[0];if(!file)return;const rd=new FileReader();rd.onload=()=>{try{const o=JSON.parse(rd.result),g=o.type==='FeatureCollection'?(o.features[0]&&o.features[0].geometry):(o.type==='Feature'?o.geometry:o);if(!g)throw new Error('Thiếu geometry');if(g.type==='Polygon'||g.type==='MultiPolygon'){geometry=g;const s=samplePolygon(g,$('boundarySpacing').value);setCenters(s,s.length+' điểm lấy mẫu từ GeoJSON');$('boundaryStatus').textContent='Đã nạp '+file.name}else if(g.type==='LineString'){setMode('route');geometry=g;const pts=g.coordinates.map(c=>({lat:+c[1],lon:+c[0]})),s=sampleLine(pts,$('routeSpacing').value);setCenters(s,s.length+' điểm dọc LineString')}else throw new Error('Chỉ hỗ trợ Polygon/MultiPolygon/LineString')}catch(err){$('boundaryStatus').textContent='Lỗi GeoJSON: '+err.message}};rd.readAsText(file)};
$('clearSpatial').onclick=()=>{geometry=null;setCenters([],'Đã xóa phạm vi không gian.');$('lat').value='';$('lon').value='';$('boundaryStatus').textContent=''};

$('saveApi').onclick=()=>{const b=apiBase();if(!b){setStatus($('apiStatus'),'Hãy nhập URL backend.','warn');return}localStorage.setItem('gmapsApiBase',b);$('apiBase').value=b;setStatus($('apiStatus'),'Đã lưu backend.','ok')};
$('testApi').onclick=async()=>{const b=apiBase();if(!b){setStatus($('apiStatus'),'Chưa có backend.','warn');return}setStatus($('apiStatus'),'Đang kiểm tra…');try{const r=await fetch(b+'/api/v1/jobs');if(!r.ok)throw new Error('HTTP '+r.status);setStatus($('apiStatus'),'Kết nối API thành công.','ok');await loadJobs()}catch(e){setStatus($('apiStatus'),'Không kết nối được: '+e.message,'error')}};

function buildPayload(){
 const qs=$('keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 if(!qs.length)throw new Error('Cần ít nhất một truy vấn.');
 if(mode==='text'){const a=$('areaHint').value.trim();if(a)for(let i=0;i<qs.length;i++)if(!qs[i].toLowerCase().includes(a.toLowerCase()))qs[i]+=' in '+a;}
 let cs=centers.slice();
 if(mode==='radius'){const p={lat:+$('lat').value,lon:+$('lon').value};if(!pointValid(p))throw new Error('Tọa độ không hợp lệ.');cs=[p];}
 if((mode==='route'||mode==='boundary')&&!cs.length)throw new Error('Chưa tạo các điểm lấy mẫu không gian.');
 return {name:$('jobName').value.trim()||('Spatial search '+new Date().toISOString().slice(0,19)),keywords:qs,centers:cs,geo_mode:mode,lang:$('lang').value.trim()||'vi',zoom:+$('zoom').value||15,lat:mode==='radius'?String($('lat').value):'',lon:mode==='radius'?String($('lon').value):'',fast_mode:$('fastMode').checked,radius:+$('radius').value||5000,depth:+$('depth').value||10,email:$('fetchEmail').checked,max_time:+$('maxTime').value||600,proxies:[]};
}
$('startJob').onclick=async()=>{const b=apiBase();if(!b){setStatus($('jobStatus'),'GitHub Pages chưa có backend. Hãy nhập URL API HTTPS.','warn');return}try{const payload=buildPayload();setStatus($('jobStatus'),'Đang tạo tác vụ…');const r=await fetch(b+'/api/v1/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||('HTTP '+r.status));setStatus($('jobStatus'),'Đã tạo job '+d.id,'ok');await loadJobs()}catch(e){setStatus($('jobStatus'),e.message,'error')}};

function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function loadJobs(){const b=apiBase();if(!b){$('jobsBody').innerHTML='<tr><td colspan="4" class="empty">Chưa kết nối backend.</td></tr>';return}try{const r=await fetch(b+'/api/v1/jobs');if(!r.ok)throw new Error('HTTP '+r.status);const jobs=await r.json();if(!jobs.length){$('jobsBody').innerHTML='<tr><td colspan="4" class="empty">Chưa có tác vụ.</td></tr>';return}$('jobsBody').innerHTML=jobs.slice(0,50).map(j=>{const id=esc(j.ID||j.id),name=esc(j.Name||j.name),st=esc(j.Status||j.status);return '<tr><td>'+name+'</td><td><span class="pill '+st+'">'+st+'</span></td><td><code>'+id+'</code></td><td><div class="actions"><a href="'+b+'/api/v1/jobs/'+id+'/export?format=csv">CSV</a><a href="'+b+'/api/v1/jobs/'+id+'/export?format=json">JSON</a><a href="'+b+'/api/v1/jobs/'+id+'/export?format=geojson">GeoJSON</a></div></td></tr>'}).join('')}catch(e){$('jobsBody').innerHTML='<tr><td colspan="4" class="empty">Lỗi API: '+esc(e.message)+'</td></tr>'}}
$('refreshJobs').onclick=loadJobs;

const stored=localStorage.getItem('gmapsApiBase');if(stored)$('apiBase').value=stored;
setMode('text');if(stored)loadJobs();
})();