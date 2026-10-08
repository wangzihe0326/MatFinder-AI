// FA-003: synthetic TEST ONLY measurements, not manufacturer datasheet content.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { bootstrapFixture } = require("./schema-test-fixtures");
const { MaterialRepository } = require("../catalog-policy").loadCanonicalPolicy().repository;
const policy = require("../property-projection-policy");

function insertMaterial(db, id, name = id, category = "Projection") {
  const base = {
    material_id: id, name: id, name_en: id, name_zh: id,
    abbreviation: id, category: "Fixtures", category_en: "Fixtures",
    category_zh: "Fixtures", processing_methods: "[]", applications: "[]",
    applications_en: "[]", applications_zh: "[]", limitations: "[]",
    alternatives: "[]", source_note: "", typical_applications: "[]", advantages: "[]",
    disadvantages: "[]", tags_en: "[]", tags_zh: "[]", summary: "",
    description_en: "", description_zh: "", translation_quality: "partial",
    translation_status: "partial", notes: "", record_type: "commercial_grade",
    record_origin: "imported", scope_status: "in_scope", catalog_visibility: "public"
  };
  Object.assign(base,{name,name_en:name,name_zh:name,category});
  const columns=Object.keys(base);
  db.prepare(`INSERT INTO materials (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`)
    .run(...columns.map(k=>base[k]));
  db.prepare(`INSERT INTO real_material_identities (material_id,manufacturer,commercial_grade,
    material_family,manufacturer_key,commercial_grade_key,material_family_key,created_at,active)
    VALUES (?,'TEST ONLY',?,'PC','test only',?,'pc','2026-01-01',1)`).run(id,id,id.toLowerCase());
  db.prepare(`INSERT INTO material_evidence (material_id,manufacturer,commercial_grade,material_family,
    source_type,source_title,source_url,verification_status,confidence_level)
    VALUES (?,'TEST ONLY',?,'PC','manufacturer','TEST ONLY identity',
    'https://example.invalid/identity','verified','high')`).run(id,id);
}
function insertClaim(db,id,key,value,options={}) {
  const row = { material_id:id,property_key:key,position:0,value_numeric:value,
    unit: key==='density'?'g/cm3':key==='tensile_strength'?'MPa':'degC',
    test_standard:'TEST STANDARD',test_condition:'TEST CONDITION',value_type:'typical',
    source_type:'manufacturer',source_title:'TEST ONLY property',source_url:'https://example.invalid/property',
    verification_status:'verified',confidence_level:'medium',conflict_status:'none',...options };
  const keys=Object.keys(row);
  db.prepare(`INSERT INTO material_property_evidence (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`)
    .run(...keys.map(k=>row[k]));
}
function populate(db) {
  insertMaterial(db,'PC-LIKE','A PC-like');
  insertClaim(db,'PC-LIKE','tensile_strength',65);
  insertClaim(db,'PC-LIKE','density',1.2);
  insertMaterial(db,'PA-LIKE','B PA-like');
  insertClaim(db,'PA-LIKE','tensile_strength',85,{test_condition:'dry'});
  insertClaim(db,'PA-LIKE','tensile_strength',50,{position:1,test_condition:'conditioned'});
  insertClaim(db,'PA-LIKE','density',1.13);
  insertMaterial(db,'MISSING','C Missing');
}
function checkRepository(repository) {
  const list=options=>repository.listMaterials({limit:200,category:"Projection",...options});
  assert.deepEqual(list({minTensileMpa:40}).items.map(x=>x.id),['PC-LIKE'],
    'FA-003 verified evidence 65 MPa must pass 40 before pagination');
  assert.equal(list({minTensileMpa:70}).total,0);
  assert.equal(list({}).total,3);
  assert.deepEqual(list({sort:'density'}).items.map(x=>x.id),['PA-LIKE','PC-LIKE','MISSING']);
  const pc=list({query:'PC-LIKE'}).items[0];
  assert.equal(pc.tensile,65);
  assert.equal(pc.propertyProjections.tensile_strength.projectionState,'single');
  assert.equal(repository.getMaterialById('PC-LIKE').propertyProjections.tensile_strength.value,65);
  assert.equal(list({minTempC:0}).total,0);
}
function policyCases() {
  const one = (overrides={}) => ({value:65, options:overrides});
  return [
    ['single', [one()], 'single', 65],
    ['missing', [], 'unknown', null],
    ['duplicates', [one(),one()], 'single',65],
    ['spread', [one(),{value:66}], 'range',null],
    ['conditions', [{value:35,options:{test_condition:'dry'}},{value:65,options:{test_condition:'wet'}}], 'multiple',null],
    ['both-pass-but-contexts', [{value:85,options:{test_condition:'dry'}},{value:50,options:{test_condition:'conditioned'}}], 'multiple',null],
    ['standards', [one(),one({test_standard:'OTHER STANDARD'})], 'multiple',null],
    ['minimum', [one({value_type:'minimum'})], 'single',null],
    ['maximum', [one({value_type:'maximum'})], 'single',null],
    ['types', [one(),one({value_type:'minimum'})], 'multiple',null],
    ['conflict', [one({conflict_status:'conflicting'}),one()], 'conflicting',null],
    ['quarantine', [one(),one({verification_status:'quarantined'})], 'unknown',null],
    ['generated', [one({source_type:'generated'})], 'unknown',null],
    ['partial', [one({verification_status:'partially_verified'})], 'single',null],
    ['partial-agrees', [one(),one({verification_status:'partially_verified'})], 'single',65],
    ['partial-spread', [one(),{value:35,options:{verification_status:'partially_verified'}}], 'range',null],
    ['partial-context', [one(),one({verification_status:'partially_verified',test_condition:'wet'})], 'multiple',null],
    ['unverified', [one({verification_status:'unverified'})], 'unknown',null],
    ['source-control', [one({source_url:'https://example.invalid/a\tb'})], 'unknown',null],
    ['hostile-context', [one({test_condition:'<img src=x onerror=alert(1)>; 23 C'})], 'single',65],
    ['low', [one({confidence_level:'low'})], 'unknown',null],
    ['estimated', [one({value_type:'estimated'})], 'unknown',null],
    ['unknown-type', [one({value_type:'unknown'})], 'unknown',null],
    ['no-standard', [one({test_standard:null})], 'unknown',null],
    ['no-condition', [one({test_condition:'   '})], 'unknown',null],
    ['no-source', [one({source_title:null})], 'unknown',null],
    ['source-unsafe', [one({source_url:'javascript:alert(1)'})], 'unknown',null],
    ['source-space', [one({source_url:'https:// bad'})], 'unknown',null],
    ['source-nul', [one({source_url:'https://example.invalid/a\0b'})], 'unknown',null],
    ['source-no-authority', [one({source_url:'https:///path'})], 'unknown',null],
    ['source-upper', [one({source_url:'HTTPS://example.invalid/test'})], 'single',65],
    ['numeric-text', [{value:'65x'}], 'unknown',null],
    ['numeric-null', [{value:null}], 'unknown',null],
    ['numeric-infinity', [{value:Infinity}], 'unknown',null],
    ['negative', [{value:-1}], 'unknown',null],
    ['wrong-dimension', [one({unit:'degC'})], 'unknown',null],
    ['wrong-unit', [one({unit:'bogus'})], 'unknown',null],
    ['gpa-negative', [{value:-1,options:{unit:'GPa'}}], 'unknown',null],
    ['gpa', [{value:0.065,options:{unit:'GPa'}}], 'unknown',null],
    ['trim-case', [one(),one({test_standard:' test standard ',test_condition:' TEST condition '})], 'single',65],
    ['numeric-context-text', [one({test_condition:'1.8 MPa'}),one({test_condition:'1.80 MPa'})], 'multiple',null],
    ['unicode-context', [one({test_condition:'Ä'}),one({test_condition:'ä'})], 'multiple',null],
    ['context-nul', [one(),one({test_condition:'TEST CONDITION\0OTHER'})], 'multiple',null],
    ['internal-space', [one(),one({test_condition:'TEST  CONDITION'})], 'multiple',null],
    ['normalized', [one({source_id:900,source_title:null,source_url:null})], 'single',65],
    ['normalized-empty', [one({source_id:901})], 'unknown',null],
    ['density', [{value:1.2}], 'single',1.2,'density'],
    ['density-zero', [{value:0}], 'unknown',null,'density'],
    ['kgm3-negative', [{value:-1,options:{unit:'kg/m3'}}], 'unknown',null,'density'],
    ['kgm3', [{value:1200,options:{unit:'kg/m3'}}], 'unknown',null,'density'],
    ['hdt-single', [{value:124,options:{test_condition:'1.80 MPa'}}], 'single',null,'hdt'],
    ['hdt-loads', [{value:124,options:{test_condition:'1.80 MPa'}},{value:137,options:{test_condition:'0.45 MPa'}}], 'multiple',null,'hdt'],
    ['continuous', [{value:110}], 'single',110,'continuous_use_temperature'],
    ['continuous-absolute-zero', [{value:-300}], 'unknown',null,'continuous_use_temperature'],
    ['kelvin', [{value:380,options:{unit:'K'}}], 'unknown',null,'continuous_use_temperature']
  ];
}
function populateMatrix(db) {
  for (const [id,title] of [[900,'TEST ONLY normalized'],[901,'']])
    db.prepare(`INSERT INTO evidence_sources(source_id,source_fingerprint,source_type,source_title,source_url,created_at)
      VALUES (?,?,'manufacturer',?,'https://example.invalid/normalized','2026-01-01')`).run(id,`TEST-${id}`,title);
  for (const [name,claims,,,key='tensile_strength'] of policyCases()) {
    const id=`POLICY-${name}`;insertMaterial(db,id,id,'PolicyMatrix');
    claims.forEach((c,index)=>insertClaim(db,id,key,c.value,{position:index,...c.options}));
  }
  insertMaterial(db,'THERMAL-ONLY','Thermal','PolicyMatrix');
  for(const key of ['max_temperature','melting_temperature','hdt','rti','short_term_temperature'])
    insertClaim(db,'THERMAL-ONLY',key,260);
  db.prepare('UPDATE materials SET max_temperature=260 WHERE material_id=?').run('THERMAL-ONLY');
  insertMaterial(db,'MANY-CLAIMS','Many contexts','HeavyProjection');
  for(let position=0;position<400;position++)
    insertClaim(db,'MANY-CLAIMS','tensile_strength',65,{position,test_condition:`Condition ${position}`});

}
function rawClaims(repository,id) {
  return repository.database.prepare(`SELECT ${policy.claimJsonSql()} AS claim
    FROM material_property_evidence p LEFT JOIN evidence_sources s ON s.source_id=p.source_id
    WHERE p.material_id=? ORDER BY p.position`).all(id).map(row=>JSON.parse(row.claim));
}
function matrixChecks(repository) {
  for(const [name,,state,keyValue,key='tensile_strength'] of policyCases()) {
    const id=`POLICY-${name}`,rows=rawClaims(repository,id);
    const actual=policy.projectProperty(id,key,rows);
    assert.equal(actual.projectionState,state,name);
    assert.equal(actual.queryKey,keyValue,name);
    const sqlKey=repository.database.prepare(`SELECT ${policy.queryKeySql('m.material_id',key)} AS value FROM materials m WHERE m.material_id=?`).get(id).value;
    assert.equal(sqlKey,keyValue,name+' SQL key');
    assert.deepEqual(policy.projectProperty(id,key,[...rows].reverse()),actual,name+' ordering');
    const tiers=repository.database.prepare(`SELECT p.id,${policy.eligibilitySql()} tier FROM material_property_evidence p LEFT JOIN evidence_sources s ON s.source_id=p.source_id WHERE p.material_id=? ORDER BY p.position`).all(id);
    assert.deepEqual(tiers.map(r=>r.tier),rows.map(r=>policy.classifyClaim(r,id).tier),name+' tiers');
  }
  assert.equal(policy.evaluateThreshold(policy.projectProperty('M','tensile_strength',[{
    ...rawClaims(repository,'PC-LIKE')[0],material_id:'M',property_key:'tensile_strength',unit:'MPa',value_numeric:65
  }]),40),'PASS');
  assert.equal(repository.getMaterialById('THERMAL-ONLY').continuous_use_temperature,null);
  assert.equal(repository.listMaterials({category:'PolicyMatrix',query:'THERMAL-ONLY',minTempC:0}).total,0);
  const sourceRow=rawClaims(repository,'POLICY-normalized')[0];
  assert.equal(policy.classifyClaim({...sourceRow,source_id:999,resolved_source_id:null},sourceRow.material_id).tier,'F');
  // Formal-v1 rejects NULL enum fields on INSERT. Exercise adapter fail-closed
  // behavior with a SELECT-only row instead of weakening fixture constraints.
  const fieldNames=['property_key','value_numeric','unit','test_standard','test_condition','value_type',
    'verification_status','confidence_level','conflict_status','source_type','source_title','source_url'];
  const sqlFields=Object.fromEntries(fieldNames.map(key=>[key,`q.${key}`]));
  Object.assign(sqlFields,{relation_ok:'1',source_ok:'1'});
  const nullStatement=repository.database.prepare(`SELECT ${policy.eligibilitySql(sqlFields)} AS tier
    FROM (SELECT ${fieldNames.map(key=>`? AS ${key}`).join(',')}) q`);
  for(const [field,value,tier] of [['confidence_level',null,'C'],['verification_status',null,'C'],['unit',null,'F'],['value_type',null,'C'],['verification_status','bogus','F']]) {
    const row={...sourceRow,[field]:value};
    assert.equal(policy.classifyClaim(row,row.material_id).tier,tier,field+' invalid/NULL JS');
    assert.equal(nullStatement.get(...fieldNames.map(key=>row[key]??null)).tier,tier,field+' invalid/NULL SQL');
  }

  const repeated=Array.from({length:20},(_,i)=>({...sourceRow,id:i,position:i,test_condition:`Condition ${i}`}));
  const bounded=policy.projectProperty(sourceRow.material_id,'tensile_strength',repeated);
  assert.equal(bounded.contextCount,20);assert.equal(bounded.queryKey,null);assert.equal(bounded.complete,false);
  assert.equal(bounded.entries.length,12);
  const duplicate=policy.projectProperty('POLICY-duplicates','tensile_strength',rawClaims(repository,'POLICY-duplicates'));
  assert.equal(duplicate.entries[0].supportingClaimRefs.length,2);
  const versioned=rawClaims(repository,'POLICY-spread').map((row,i)=>({...row,position:99-i,
    evidence_version:String(100-i),last_verified_at:`2026-01-${10+i}`,source_id:null,
    source_type:i?'academic':'manufacturer',source_title:`Version source ${i}`}));
  const versionProjection=policy.projectProperty('POLICY-spread','tensile_strength',versioned);
  assert.equal(versionProjection.projectionState,'range');assert.equal(versionProjection.queryKey,null);
  const continuous=repository.getMaterialById('POLICY-continuous').propertyProjections.continuous_use_temperature;
  assert.equal(policy.evaluateThreshold(continuous,100),'PASS');assert.equal(policy.evaluateThreshold(continuous,120),'FAIL');
  for(const [threshold,total] of [[100,1],[120,0]])
    assert.equal(repository.listMaterials({query:'POLICY-continuous',minTempC:threshold}).total,total);
  const tied=repository.listMaterials({category:'PolicyMatrix',sort:'strength',limit:200}).items;
  const firstUnknown=tied.findIndex(item=>item.tensile===null);
  assert.ok(firstUnknown>0);assert.ok(tied.slice(firstUnknown).every(item=>item.tensile===null));
  const heavyPage=repository.listMaterials({category:'HeavyProjection'});
  assert.equal(heavyPage.total,1);assert.equal(heavyPage.items.length,1);
  const heavy=heavyPage.items[0].propertyProjections.tensile_strength;
  assert.equal(heavy.contextCount,400);assert.equal(heavy.queryKey,null);assert.equal(heavy.complete,false);
  assert.equal(heavy.entries.length,0);
  const heavyDetail=repository.getMaterialById('MANY-CLAIMS');
  assert.equal(heavyDetail.propertyProjections.tensile_strength.entries.length,12);
  assert.equal(heavyDetail.evidence.properties.tensile_strength.length,400,'raw detail remains complete');
  assert.equal(repository.listMaterials({category:'HeavyProjection',minTensileMpa:40}).total,0);
  const partial=repository.getMaterialById('POLICY-partial');
  assert.equal(partial.tensile,null);assert.equal(partial.propertyProjections.tensile_strength.value,65);
  assert.equal(partial.propertyProjections.tensile_strength.sourceState,'partially_verified');
  const complete=repository.listMaterials({category:'PolicyMatrix',sort:'strength',limit:200});
  const paged=[];
  for(let offset=0;offset<complete.total;offset+=7) {
    const page=repository.listMaterials({category:'PolicyMatrix',sort:'strength',limit:7,offset});
    assert.equal(page.total,complete.total);paged.push(...page.items.map(x=>x.id));
  }
  assert.deepEqual(paged,complete.items.map(x=>x.id));assert.equal(new Set(paged).size,paged.length);
  const views=require('./test-catalog-frontend').snapshotProjectionConsumers(
    ['spread','hdt-loads','hdt-single','hostile-context','minimum','conflict'].map(name=>repository.getMaterialById(`POLICY-${name}`)));
  assert.ok(views['POLICY-spread'].tensile_strength.summary.includes('Observed values'));
  assert.ok(views['POLICY-spread'].tensile_strength.compareHtml.includes('65, 66 MPa'));
  for(const fragment of ['124 degC','137 degC','1.80 mpa','0.45 mpa'])
    assert.ok(views['POLICY-hdt-loads'].hdt.compareHtml.includes(fragment),fragment);
  assert.ok(views['POLICY-hdt-single'].hdt.compareHtml.includes('1.80 mpa'));
  assert.ok(views['POLICY-minimum'].tensile_strength.summary.includes('minimum'));
  assert.ok(!views['POLICY-hostile-context'].tensile_strength.compareHtml.includes('<img'));
  assert.ok(views['POLICY-hostile-context'].tensile_strength.compareHtml.includes('&lt;img'));
  assert.equal(repository.getMaterialById('POLICY-quarantine'),null,'existing public quarantine boundary');
  assert.ok(!views['POLICY-conflict'].tensile_strength.compareHtml.includes('65 MPa'));
  console.log(`FA-003 JS/SQL policy matrix: ${policyCases().length} cases PASS; count/pagination PASS.`);
}

async function httpChecks(databasePath) {
  const listener=net.createServer();
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const child=spawn(process.execPath,[__filename,'--projection-server'],{cwd:path.resolve(__dirname,'..'),windowsHide:true,
    env:{...process.env,NODE_ENV:'test',PORT:String(port),MATFINDER_DB_PATH:databasePath,OPENAI_API_KEY:'',MATFINDER_ADMIN_TOKEN:''},stdio:['ignore','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
  const ended=new Promise(resolve=>child.once('exit',resolve));
  try {
    for(let i=0;i<200&&!output.includes('"phase":"after_http_listen"')&&child.exitCode===null;i++)await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(child.exitCode,null,errors);assert.ok(output.includes('"phase":"after_http_listen"'),errors);
    const response=await fetch(`http://127.0.0.1:${port}/api/materials?category=Projection&minTensileMpa=40`);
    assert.equal(response.status,200);const body=await response.json();
    assert.equal(body.total,1);assert.equal(response.headers.get('x-total-count'),'1');
    assert.equal(body.items[0].id,'PC-LIKE');assert.equal(body.items[0].tensile,65);
    assert.equal(body.items[0].propertyProjections.tensile_strength.value,65);
    const detail=await (await fetch(`http://127.0.0.1:${port}/api/materials/PC-LIKE`)).json();
    const material=detail.material||detail;
    assert.equal(material.propertyProjections.tensile_strength.value,65);
    assert.equal(material.evidence.properties.tensile_strength[0].value,65);
    console.log('FA-003 real local HTTP list/detail projection and total PASS.');
  } finally {
    if(child.exitCode===null&&child.signalCode===null){child.kill();await Promise.race([ended,new Promise(resolve=>setTimeout(resolve,3000))]);}
  }
}

async function scaleChecks() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'matfinder-fa003-scale-'));
  const baselineArg=process.argv.find(x=>x.startsWith('--baseline-root='));
  const variants=[['candidate',MaterialRepository]];
  if(baselineArg) variants.unshift(['baseline',require(path.join(baselineArg.slice('--baseline-root='.length),'catalog-policy.js')).loadCanonicalPolicy().repository.MaterialRepository]);
  const output=[];
  try {
    for(const size of [1000,10000]) {
      const file=path.join(directory,`scale-${size}.db`);bootstrapFixture(file);
      const db=new DatabaseSync(file);
      try {
        db.exec('BEGIN');
        for(let i=0;i<size;i++) {
          const id=`S-${String(i).padStart(6,'0')}`;insertMaterial(db,id,'Same name','Scale');
          insertClaim(db,id,'density',1+(i%10)/100);
          insertClaim(db,id,'tensile_strength',65);
          insertClaim(db,id,'tensile_strength',i%5===0?50:65,{position:1,test_condition:i%5===0?'conditioned':'TEST CONDITION'});
          insertClaim(db,id,'continuous_use_temperature',110);
          insertClaim(db,id,'hdt',124,{test_condition:'1.8 MPa'});
          insertClaim(db,id,'hdt',137,{position:1,test_condition:'0.45 MPa'});
        }
        db.exec('COMMIT');
      } finally {db.close();}
      for(const [variant,Repository] of variants) for(const [label,options] of [
        ['unfiltered',{}],['tensile',{minTensileMpa:40}],['density',{sort:'density'}],
        ['strength',{sort:'strength'}],['temperature',{sort:'temperature'}],
        ['combined',{minTensileMpa:40,minTempC:100}]
      ]) {
        const repo=new Repository(file);let maxHydratedMaterials=0;const plans={};
        for(const method of ['_get','_all','_readAd08Rows']) {
          const original=repo[method];
          repo[method]=function(sql,params,tag) {
            if(tag==='property_evidence')maxHydratedMaterials=Math.max(maxHydratedMaterials,params.length);
            if(['material_list','catalog_count','catalog_performance_facets'].includes(tag)&&!plans[tag])
              plans[tag]=this.database.prepare('EXPLAIN QUERY PLAN '+sql).all(...params).map(x=>x.detail);
            return original.apply(this,arguments);
          };
        }
        try {
          global.gc?.();const before=process.memoryUsage();const begin=performance.now();
          const page=repo.listMaterials({...options,limit:48});
          const elapsed=performance.now()-begin,after=process.memoryUsage();
          assert.equal(new Set(page.items.map(x=>x.id)).size,page.items.length);
          assert.ok(maxHydratedMaterials<=30);assert.equal(repo.getMetrics().fullEvidenceTableReads,0);
          assert.ok(repo.getMetrics().maximumRowsInSingleQuery<=180);
          if(variant==='candidate') {
            assert.equal(page.total,label==='tensile'||label==='combined'?size*0.8:size);
            assert.equal(page.items.length,48);
            assert.ok(!Object.values(plans).flat().some(x=>/^SCAN p\b/.test(x)),'Evidence lookup must use material/property index');
          }
          const result={size,variant,label,elapsedMs:Number(elapsed.toFixed(2)),total:page.total,rows:page.items.length,
            responseBytes:Buffer.byteLength(JSON.stringify(page)),maxHydratedMaterials,metrics:repo.getMetrics(),
            heapDelta:after.heapUsed-before.heapUsed,rssDelta:after.rss-before.rss,plans};
          output.push(result);console.log(JSON.stringify({...result,plans:undefined}));
        } finally {repo.close();}
      }
    }
    const arg=process.argv.find(x=>x.startsWith('--output='));
    if(arg)fs.writeFileSync(arg.slice('--output='.length),JSON.stringify(output,null,2));
    return output;
  } finally {
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('matfinder-fa003-scale-'));
    fs.rmSync(directory,{recursive:true,force:true});
  }
}


function populateR1Facets(db) {
  for (const letter of "ABCDEFGH") {
    const id="R1-"+letter;
    insertMaterial(db,id,"R1 shared", "ABDE".includes(letter)?"R1 category A":"R1 category B");
    db.prepare("UPDATE materials SET summary=? WHERE material_id=?")
      .run("AB".includes(letter)?"high strength automotive":"",id);
    insertClaim(db,id,"density",letter==="B"?1.1:1.2);
    insertClaim(db,id,"continuous_use_temperature",110);
    if (letter === "E") continue;
    const options = letter === "D" ? {verification_status:"partially_verified"}
      : letter === "F" ? {conflict_status:"conflicting"}
      : letter === "G" ? {verification_status:"quarantined"}
      : letter === "B" ? {source_id:900,source_title:null,source_url:null} : {};
    insertClaim(db,id,"tensile_strength",letter==="C"?75:65,options);
    if (letter === "A" || letter === "B") insertClaim(db,id,"tensile_strength",65,{...options,position:1});
    if (letter === "H") insertClaim(db,id,"tensile_strength",50,{position:1,test_condition:"conditioned"});
  }
}
function r1FacetCorrectnessChecks(repository) {
  const list=options=>repository.listMaterials({query:"R1-",limit:200,...options});
  const ids=letters=>[...letters].map(x=>"R1-"+x);
  for (const [options,expected] of [
    [{},"ABCDEFH"], [{minTensileMpa:40},"ABC"], [{minTensileMpa:65},"ABC"],
    [{minTensileMpa:70},"C"], [{minTempC:100},"ABCDEFH"],
    [{minTensileMpa:40,minTempC:100},"ABC"], [{sort:"density"},"BACDEFH"],
    [{sort:"strength"},"CABDEFH"], [{sort:"temperature"},"ABCDEFH"],
    [{minTensileMpa:40,minTempC:100,sort:"strength"},"CAB"]
  ]) {
    const full=list(options);assert.deepEqual(full.items.map(x=>x.id),ids(expected));
    assert.equal(full.total,expected.length);assert.equal(full.hasMore,false);
    for(const dimension of ["categories","performance","domains"]) assert.equal(full.facets[dimension].all,expected.length);
    const paged=[];
    for(let offset=0;offset<expected.length;offset+=2) {
      const page=list({...options,limit:2,offset});paged.push(...page.items.map(x=>x.id));
      assert.equal(page.total,expected.length);assert.equal(page.hasMore,offset+2<expected.length);
      assert.deepEqual(page.facets,full.facets,"facets cover the full query, not only the page");
    }
    assert.deepEqual(paged,ids(expected));
  }
  const thresholds={minTensileMpa:40,minTempC:100};
  const category=list({...thresholds,category:"R1 category A",limit:1});
  assert.equal(category.total,2);assert.equal(category.facets.categories.all,3);
  assert.deepEqual(category.facets.categories.options,[{value:"R1 category A",count:2},{value:"R1 category B",count:1}]);
  for(const [option,dimension] of [[{performance:"high-strength"},"performance"],[{domain:"automotive"},"domains"]]) {
    const page=list({...thresholds,...option,limit:1});assert.equal(page.total,2);
    assert.equal(page.facets[dimension].all,3,"facet excludes its own active dimension");
    assert.equal(page.facets[dimension].options.find(x=>x.id===Object.values(option)[0]).count,2);
  }
  const b=repository.getMaterialById("R1-B").propertyProjections.tensile_strength;
  assert.equal(b.queryKey,65);assert.equal(b.entries[0].sourceCount,1);assert.equal(b.entries[0].sourceReferenceCount,2);
  assert.equal(repository.getMaterialById("R1-D").propertyProjections.tensile_strength.sourceState,"partially_verified");
  assert.equal(repository.getMaterialById("R1-H").propertyProjections.tensile_strength.projectionState,"multiple");
  console.log("FA-003 R1 facets: 10 query modes, normalized/inline/duplicate/status, full totals, self-exclusion, stable pagination PASS.");
}

function r1QueryPlanChecks(repository) {
  const plans = [];
  const originals = Object.fromEntries(["_get", "_all"].map(method => [method, repository[method]]));
  try {
    for (const [method, original] of Object.entries(originals)) repository[method] = function(sql, params, tag) {
      const result = original.apply(this, arguments);
      if (tag.startsWith("catalog_") || tag === "material_list")
        plans.push({ tag, rows: this.database.prepare("EXPLAIN QUERY PLAN " + sql).all(...params) });
      return result;
    };
    for (const options of [{sort:"density"}, {sort:"strength"}, {sort:"temperature"},
      {minTensileMpa:40,minTempC:100,sort:"strength",offset:1}]) {
      plans.length = 0;
      repository.listMaterials({limit:7,...options});
      for (const {tag,rows} of plans) {
        const materializations=rows.filter(row => /MATERIALIZE pp_claims\b/i.test(row.detail));
        if (tag === "material_list" || options.minTensileMpa !== undefined)
          assert.equal(materializations.length,1,tag+": actual plan must qualify relevant evidence once");
        assert.ok(!rows.some(row => /^SCAN p\b/.test(row.detail)),tag+": evidence must use scoped material/key lookups");
        // Check access semantics, not SQLite's index name or exact plan formatting.
        for (const row of rows.filter(row => /^(SEARCH|SCAN) pp_(density|tensile_strength|continuous_use_temperature)\b/i.test(row.detail))) {
          assert.match(row.detail, /material_id\s*=\s*\?/i,
            tag + ": projected key access must be constrained by current material identity");
        }
      }
    }
  } finally { for (const [method,original] of Object.entries(originals)) repository[method]=original; }
  console.log("FA-003 R1 actual SQL plan: one shared qualification per numeric statement PASS.");
}
function r1SourceCountChecks(repository) {
  const row=rawClaims(repository,'PC-LIKE').find(claim=>claim.property_key==='tensile_strength');
  for(const count of [0,1,8,9,12,17]) {
    const rows=Array.from({length:count},(_,i)=>({...row,id:i+1,position:i,
      source_id:null,resolved_source_id:null,source_title:'TEST source '+i,source_url:'https://example.invalid/'+i}));
    const projection=policy.projectProperty(row.material_id,'tensile_strength',rows);
    if(count) {
      const entry=projection.entries[0];
      assert.equal(entry.claimCount,count);
      assert.equal(entry.sourceReferenceCount,count);
      assert.equal(entry.sourceCount,count);
      assert.equal(entry.distinctValueCount,1);
      assert.equal(entry.supportingClaimRefs.length,Math.min(count,8));
    } else assert.equal(projection.entries.length,0);
    assert.equal(projection.claimCount,count);
  }
  const repeated=Array.from({length:12},(_,i)=>({...row,id:i+1,position:i,source_id:901,resolved_source_id:901}));
  const entry=policy.projectProperty(row.material_id,'tensile_strength',repeated).entries[0];
  assert.equal(entry.sourceCount,1,'12 claims referencing one registered source are not 12 sources');
  assert.equal(entry.sourceReferenceCount,12);
  assert.equal(entry.distinctValueCount,1);
  console.log("FA-003 R1 provenance counts 0/1/8/9/12/17 and duplicate-source distinction PASS.");
}

async function main() {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'matfinder-fa003-projection-'));
  const file=path.join(directory,'test-only.db');
  let repository;
  try {
    bootstrapFixture(file);
    const db=new DatabaseSync(file);
    try { populate(db); populateMatrix(db); populateR1Facets(db); } finally {db.close();}
    repository=new MaterialRepository(file);
    checkRepository(repository);
    matrixChecks(repository);
    r1FacetCorrectnessChecks(repository);
    r1QueryPlanChecks(repository);
    r1SourceCountChecks(repository);
    const frontendItems=['PC-LIKE','PA-LIKE','POLICY-partial'].map(id=>repository.getMaterialById(id));
    frontendItems[0].maxTemp=260;
    require('./test-catalog-frontend').assertProjectionConsumers(frontendItems);
    await httpChecks(file);
    console.log('FA-003 property projection regressions passed.');
  } finally {
    repository?.close();
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('matfinder-fa003-projection-'));
    fs.rmSync(directory,{recursive:true,force:true});
  }
}
if(process.argv.includes('--projection-server')) {
  const exists=fs.existsSync;
  fs.existsSync=function(file){if(['.env','.env.local'].includes(path.basename(String(file))))return false;return exists.apply(this,arguments);};
  global.fetch=()=>{throw new Error('FA-003 server test forbids provider/network calls');};
  require('../server');
} else if(require.main===module) (process.argv.includes('--scale')?scaleChecks():main()).catch(error=>{console.error(error);process.exitCode=1;});
module.exports={insertMaterial,insertClaim,populate,checkRepository};
