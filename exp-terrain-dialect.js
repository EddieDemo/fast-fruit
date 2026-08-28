global.window={FF:{}};
const H=require('./harness.js');
const FF=global.window.FF;
const P=FF.pilot;
const TL=FF.terrainLaws;
function thumb(a,b){const m=Math.hypot(a,b);if(m>1){a/=m;b/=m;}return {axis:a,bounce:b};}
P.register('never',()=>{const b=P.create('cruise');return{name:'never',drive(m,c){const d=b.drive(m,c);return thumb(d.axis,0);},save(){return b.save?b.save():null;},load(s){b.load&&b.load(s);}};});
P.register('timed',()=>{const b=P.create('cruise');let h=0,ask=0;return{name:'timed',drive(m,c){const d=b.drive(m,c);const g=m.hitSeverity>0||(m.airTicks||0)===0;
 if(g){h=0;ask=0;return thumb(d.axis,0);}
 if(ask<=0){ask=10;const pr=P.predictSplat(c.state,m,false,{rawAxis:d.axis,torqueAxis:d.axis,rawBounce:0,bounceAxis:0});
  if(pr&&pr.splat){const D=FF.damage;const need=D.restitutionToSurvive(pr.worst,pr.T,D.bodyRestitution(m));h=need===null?1:Math.min(1,D.restitutionToBounce(need)+0.05);}else h=0;}
 ask--;return thumb(d.axis,h);},save(){return b.save?b.save():null;},load(s){b.load&&b.load(s);}};});

const origRecipe=TL.trackRecipe; let MIX=null;
FF.terrainLaws.trackRecipe=(seed)=>{const rec=origRecipe(seed);
 if(MIX){let s=0;for(const k in MIX)s+=MIX[k]; for(const k in rec.weights) rec.weights[k]=(MIX[k]||0)/s;} return rec;};

const SEEDS=H.SWEEP_SEEDS.slice(0,8);
function trial(label,mix){
  MIX=mix; const out={};
  for(const pol of ['never','timed']){
    const t=[],d=[]; let wins=0;
    for(const seed of SEEDS){
      const r=H.runRace(seed,[{species:'watermelon',brain:pol}].concat(Array(10).fill('watermelon')),3);
      const me=r.racers[1];   // roster[0] -> bodies[1]. The policy's own body.
      const fin=r.racers.filter(x=>x.finished).sort((a,b)=>a.timeSec-b.timeSec);
      t.push(me.finished?me.timeSec:999); d.push(me.deaths);
      if(fin.length&&fin[0].key===me.key) wins++;
    }
    out[pol]={t:t.reduce((a,b)=>a+b,0)/t.length,d:d.reduce((a,b)=>a+b,0)/d.length,w:wins};
  }
  const pace=((out.never.t-out.timed.t)/out.never.t*100);
  console.log(label.padEnd(24)
    +(out.never.t.toFixed(1)+'s '+out.never.d.toFixed(1)+'d '+out.never.w+'w').padEnd(18)
    +(out.timed.t.toFixed(1)+'s '+out.timed.d.toFixed(1)+'d '+out.timed.w+'w').padEnd(18)
    +('+'+pace.toFixed(1)+'% pace').padEnd(13)
    +('-'+(out.never.d-out.timed.d).toFixed(1)+' deaths').padEnd(13)
    +'+'+(out.timed.w-out.never.w)+' wins');
}
console.log('SANITY: the instrument must show a KNOWN effect before any row is trusted.');
console.log('dialect                 never(8 races)    timed(8 races)    flare edge');
console.log('-'.repeat(100));
trial('default (shipped)', null);
trial('roller 60%', {slope:0.25,roller:0.60,flat:0.15});
trial('roller 15% (min band)', {slope:0.45,roller:0.15,flat:0.20,kicker:0.15,gap:0.05});
trial('kicker 40%', {slope:0.35,roller:0.10,flat:0.15,kicker:0.40});
trial('gap 35%', {slope:0.40,roller:0.10,flat:0.15,gap:0.35});
trial('flat 60% (benign)', {slope:0.30,roller:0.10,flat:0.60});
trial('trap+tunnel heavy', {slope:0.40,roller:0.15,flat:0.05,trap:0.25,tunnel:0.15});
