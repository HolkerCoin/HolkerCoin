import fs from 'node:fs'; import path from 'node:path'; import sharp from 'sharp';
const dir = 'brand';
for (const f of fs.readdirSync(dir)) {
  const p = path.join(dir, f); const b = fs.readFileSync(p);
  console.log('\n=== ' + f + ' (' + b.length + ' bytes)');
  console.log('magic:', b.subarray(0, 8).toString('hex'));
  if (b.subarray(1, 4).toString() === 'PNG') {
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], ct = b[25];
    console.log(`IHDR: ${w}x${h} bitdepth=${depth} colourtype=${ct} (${{0:'gray',2:'RGB',3:'indexed',4:'gray+alpha',6:'RGBA'}[ct]}) interlace=${b[28]}`);
    const chunks = []; for (let o = 8; o < b.length;) { const l = b.readUInt32BE(o); chunks.push(b.subarray(o+4,o+8).toString()); o += 12 + l; }
    console.log('chunks:', [...new Set(chunks)].join(','));
  } else console.log('JPEG (no alpha channel by format)');
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const N = info.width * info.height; const hist = new Array(8).fill(0); let pureBlackTrans = 0, transparent = 0;
  const cnt = new Map();
  for (let i = 0; i < N; i++) { const r=data[i*4],g=data[i*4+1],bl=data[i*4+2],a=data[i*4+3];
    hist[a>>5]++; if (a<255) transparent++; if (a<255 && r+g+bl===0) pureBlackTrans++;
    const k=((r>>3)<<10)|((g>>3)<<5)|(bl>>3); cnt.set(k,(cnt.get(k)||0)+1); }
  console.log('alpha histogram (8 bins of 32, 0..255):', hist.join(' '));
  console.log(`non-opaque px: ${transparent}; pure-black(0,0,0) with alpha<255: ${pureBlackTrans}`);
  // k-means k=4 on subsample
  const pts=[]; const step=Math.max(1,Math.floor(N/60000));
  for (let i=0;i<N;i+=step) pts.push([data[i*4],data[i*4+1],data[i*4+2],i]);
  let cs=[pts[0].slice(0,3)]; 
  while(cs.length<4){ let best=null,bd=-1; for(const p of pts){const d=Math.min(...cs.map(c=>(c[0]-p[0])**2+(c[1]-p[1])**2+(c[2]-p[2])**2)); if(d>bd){bd=d;best=p}} cs.push(best.slice(0,3)); }
  for (let it=0;it<25;it++){ const s=cs.map(()=>[0,0,0,0]); for(const p of pts){let bi=0,bd=1e18;cs.forEach((c,i)=>{const d=(c[0]-p[0])**2+(c[1]-p[1])**2+(c[2]-p[2])**2;if(d<bd){bd=d;bi=i}});s[bi][0]+=p[0];s[bi][1]+=p[1];s[bi][2]+=p[2];s[bi][3]++;} cs=cs.map((c,i)=>s[i][3]?[s[i][0]/s[i][3],s[i][1]/s[i][3],s[i][2]/s[i][3]]:c); }
  const share=cs.map(()=>0); for(const p of pts){let bi=0,bd=1e18;cs.forEach((c,i)=>{const d=(c[0]-p[0])**2+(c[1]-p[1])**2+(c[2]-p[2])**2;if(d<bd){bd=d;bi=i}});share[bi]++;}
  cs.forEach((c,i)=>{ // snap to nearest real pixel (full scan)
    let bd=1e18,bp=0; for(let j=0;j<N;j++){const d=(data[j*4]-c[0])**2+(data[j*4+1]-c[1])**2+(data[j*4+2]-c[2])**2; if(d<bd){bd=d;bp=j}}
    const hex='#'+[0,1,2].map(k=>data[bp*4+k].toString(16).padStart(2,'0')).join('');
    console.log(`cluster ${i}: share ${(100*share[i]/pts.length).toFixed(1)}%  centroid rgb(${c.map(Math.round)})  snapped ${hex} @ x=${bp%info.width},y=${Math.floor(bp/info.width)}`);
  });
  const top=[...cnt.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([k,v])=>`rgb5(${k>>10},${(k>>5)&31},${k&31}) ${(100*v/N).toFixed(1)}%`); console.log('dominant 5-bit bins:',top.join(' | '));
}
