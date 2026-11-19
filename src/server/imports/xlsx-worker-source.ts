// Trusted, static worker program. Uploaded bytes are DATA, never executable code.
// A worker allows a hard wall-clock termination, including synchronous inflate/XML work.
export const XLSX_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { inflateRawSync, crc32 } = require('node:zlib');
const sax = require(workerData.saxPath);
const b=Buffer.from(workerData.bytes); const deadline=Date.now()+4500;
function fail(message){throw new Error(message);}
function clock(){if(Date.now()>deadline)fail('파일 처리 시간이 초과되었습니다.');}
const decoder=new TextDecoder('utf-8',{fatal:true});
function decode(bytes){return decoder.decode(bytes);}
function unzip(){
 if(b.length<22||b.readUInt32LE(0)!==0x04034b50)fail('XLSX ZIP 형식이 아닙니다.');
 let end=-1;
 for(let p=b.length-22;p>=Math.max(0,b.length-65557);p--)if(b.readUInt32LE(p)===0x06054b50&&p+22+b.readUInt16LE(p+20)===b.length){end=p;break;}
 if(end<0)fail('손상된 XLSX ZIP입니다.');
 const count=b.readUInt16LE(end+10),size=b.readUInt32LE(end+12),offset=b.readUInt32LE(end+16);
 if(b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||count!==b.readUInt16LE(end+8)||count>200||count===0||offset+size!==end)fail('ZIP 항목 한도 또는 구조 오류입니다.');
 const files=new Map(),ranges=[];let p=offset,total=0;
 for(let i=0;i<count;i++){
  clock();if(p+46>end||b.readUInt32LE(p)!==0x02014b50)fail('손상된 ZIP 항목입니다.');
  const flags=b.readUInt16LE(p+8),method=b.readUInt16LE(p+10),crc=b.readUInt32LE(p+16),compressed=b.readUInt32LE(p+20),expanded=b.readUInt32LE(p+24),nl=b.readUInt16LE(p+28),el=b.readUInt16LE(p+30),cl=b.readUInt16LE(p+32),local=b.readUInt32LE(p+42);
  if(p+46+nl+el+cl>end||flags&1||flags&0x40||![0,8].includes(method)||b.readUInt16LE(p+34)||((b.readUInt32LE(p+38)>>>16)&0xf000)===0xa000)fail('암호화/비지원 ZIP입니다.');
  const name=decode(b.subarray(p+46,p+46+nl));p+=46+nl+el+cl;
  if(!name||name.length>240||name.includes('\\')||name.startsWith('/')||name.split('/').some(v=>v==='..'||v==='.')||files.has(name))fail('안전하지 않은 ZIP 경로입니다.');
  if(/macro|vba|externalLinks|embeddings|activeX/i.test(name)||(!name.endsWith('/')&&!/\.(xml|rels)$/i.test(name)))fail('매크로/외부 참조/임베디드 파일은 지원하지 않습니다.');
  if(local+30>offset||b.readUInt32LE(local)!==0x04034b50||b.readUInt16LE(local+6)!==flags||b.readUInt16LE(local+8)!==method)fail('ZIP 헤더가 일치하지 않습니다.');
  const lnl=b.readUInt16LE(local+26),lel=b.readUInt16LE(local+28),start=local+30+lnl+lel,finish=start+compressed;
  if(finish>offset||decode(b.subarray(local+30,local+30+lnl))!==name||ranges.some(([a,z])=>local<z&&finish>a))fail('중첩/손상 ZIP입니다.');
  ranges.push([local,finish]);
  if(expanded>4*1024*1024||total+expanded>16*1024*1024)fail('압축 해제 한도(16MiB)를 초과했습니다.');
  const data=method===0?b.subarray(start,finish):inflateRawSync(b.subarray(start,finish),{maxOutputLength:Math.min(4*1024*1024,16*1024*1024-total)});
  total+=data.length;
  if(data.length!==expanded||crc32(data)!==crc||total>16*1024*1024)fail('손상되었거나 너무 큰 ZIP입니다.');
  files.set(name,data);
 }
 if(p!==end)fail('ZIP 디렉터리 오류입니다.');
 return files;
}
let nodes=0,cells=0,strings=0;
function xml(bytes,open,close,text){
 const value=decode(bytes);
 if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/u.test(value))fail('XML에 허용되지 않는 문자가 있습니다.');
 for(const match of value.matchAll(/&#(?:x([0-9a-fA-F]+)|([0-9]+));/g)){const point=parseInt(match[1]||match[2],match[1]?16:10);if(!([9,10,13].includes(point)||(point>=32&&point<=0xd7ff)||(point>=0xe000&&point<=0xfffd)||(point>=0x10000&&point<=0x10ffff)))fail('잘못된 XML 문자 참조입니다.');}
 if(/<!DOCTYPE|<!ENTITY/i.test(value))fail('DTD/엔티티 XML은 지원하지 않습니다.');
 const parser=sax.parser(true,{xmlns:true,strictEntities:true});let depth=0,currentCell='';
 parser.onerror=()=>fail('올바르지 않은 XML입니다.');
 parser.onopentag=(node)=>{clock();if(++nodes>100000||++depth>40)fail('XML 구조 한도 초과입니다.');
  const attrs={};for(const item of Object.values(node.attributes)){if(item.value.length>4000)fail('XML 속성이 너무 깁니다.');attrs[item.name]=item.value;}
  if(node.local==='c')currentCell=attrs.r||'';
  if(['f','hyperlink','externalReference','oleObject','mergeCell'].includes(node.local))fail((attrs.ref||currentCell||'XML')+' 셀: 수식/링크/외부 참조/병합 셀은 지원하지 않습니다.');
  if(node.local==='Relationship'&&(attrs.TargetMode==='External'||/hyperlink|externalLink|vbaProject|oleObject/i.test(attrs.Type||'')))fail('외부 링크는 지원하지 않습니다.');
  if(node.local==='Override'&&/macroEnabled|vbaProject/i.test(attrs.ContentType||''))fail('매크로는 지원하지 않습니다.');
  if(open)open(node.local,attrs);
 };
 parser.onclosetag=(name)=>{if(close)close(name.split(':').pop());depth--;};
 parser.ontext=(v)=>{if(v.length>65536)fail('XML 텍스트 한도 초과입니다.');if(text)text(v);};
 parser.oncdata=()=>fail('CDATA는 지원하지 않습니다.');
 for(let p=0;p<value.length;p+=4096){clock();parser.write(value.slice(p,p+4096));}parser.close();
}
function main(){
 if(b.length>2*1024*1024)fail('파일은 최대 2MiB입니다.');
 const files=unzip();for(const name of ['[Content_Types].xml','xl/workbook.xml','xl/_rels/workbook.xml.rels'])if(!files.has(name))fail('XLSX 필수 구조가 없습니다.');
 // Validate EVERY XML part, even unselected sheets and metadata.
 for(const [name,bytes] of files)if(!name.endsWith('/'))xml(bytes);
 const sheets=[],rels=new Map();
 xml(files.get('xl/workbook.xml'),(tag,a)=>{if(tag==='sheet'){if(sheets.length>=20||!a.name||a.name.length>120||!a['r:id'])fail('시트 구조 오류입니다.');sheets.push({name:a.name,id:a['r:id']});}});
 xml(files.get('xl/_rels/workbook.xml.rels'),(tag,a)=>{if(tag==='Relationship'){if(rels.has(a.Id))fail('중복 관계입니다.');rels.set(a.Id,a.Target);}});
 if(!sheets.length||new Set(sheets.map(s=>s.name)).size!==sheets.length)fail('시트 이름 오류입니다.');
 const shared=[];if(files.has('xl/sharedStrings.xml')){
  let active=false,v='',inText=false;
  xml(files.get('xl/sharedStrings.xml'),(tag)=>{if(tag==='si'){active=true;v='';if(++strings>10000)fail('공유 문자열이 너무 많습니다.');}if(tag==='t')inText=true;},(tag)=>{if(tag==='t')inText=false;if(tag==='si'){shared.push(v);active=false;}},(text)=>{if(active&&inText){v+=text;if(v.length>4000)fail('셀은 최대 4,000자입니다.');}});
 }
 const names=sheets.map(s=>s.name);const selected=workerData.sheet||(sheets.length===1?sheets[0].name:null);
 if(!selected)return {sheets:names,rows:[]};
 const sheet=sheets.find(s=>s.name===selected);if(!sheet)fail('선택한 시트가 없습니다.');
 const target=rels.get(sheet.id);if(typeof target!=='string')fail('시트 참조 오류입니다.');
 const path=target.startsWith('/xl/')?target.slice(1):'xl/'+target;
 if(!/^xl\/worksheets\/[^/]+\.xml$/.test(path)||!files.has(path))fail('지원하지 않는 시트 경로입니다.');
 const grid=new Map();let current=null,kind='',value='',inline='',capture='',seen=new Set();
 xml(files.get(path),(tag,a)=>{
  if(tag==='c'){
   if(++cells>707||!/^([A-G])([1-9][0-9]{0,2})$/.test(a.r||''))fail('문장 시트는 A:G, 최대 101행입니다.');
   if(seen.has(a.r))fail('중복 셀입니다.');seen.add(a.r);const m=/^([A-G])(\d+)$/.exec(a.r);if(Number(m[2])>101)fail('최대 100개 문장입니다.');
   current={row:Number(m[2]),col:m[1].charCodeAt(0)-65};kind=a.t||'';value='';inline='';
   if(!['s','inlineStr','str',''].includes(kind))fail(a.r+' 셀은 텍스트만 사용할 수 있습니다.');
  }
  if(tag==='v'||tag==='t')capture=tag;
 },(tag)=>{
  if(tag==='v'||tag==='t')capture='';
  if(tag==='c'&&current){let result=kind==='inlineStr'?inline:kind==='s'?shared[Number(value)]:value;
   if(kind==='s'&&(!/^\d+$/.test(value)||result===undefined))fail('공유 문자열 참조 오류입니다.');
   if(!kind&&value)fail('숫자 셀은 텍스트로 저장해 주세요.');
   if(!grid.has(current.row))grid.set(current.row,Array(7).fill(''));grid.get(current.row)[current.col]=result||'';current=null;
  }
 },(text)=>{if(current){if(capture==='v')value+=text;if(capture==='t')inline+=text;if(value.length>4000||inline.length>4000)fail('셀은 최대 4,000자입니다.');}});
 const headers=(grid.get(1)||[]).map(v=>v.trim());const allowed=['prompt','target','meaning','acceptedAnswers','hint','explanation','level'];
 const nonempty=headers.filter(Boolean);
 if(!headers.includes('prompt')||!headers.includes('target')||nonempty.some(h=>!allowed.includes(h))||new Set(nonempty).size!==nonempty.length)fail('1행 헤더: prompt,target 필수, 선택 meaning,acceptedAnswers,hint,explanation,level입니다.');
 const rows=[];
 for(const [position,values] of [...grid].sort((a,z)=>a[0]-z[0])){
  if(position===1||values.every(v=>!v.trim()))continue;
  const row={row:position,prompt:'',target:'',meaning:'',hint:'',explanation:'',acceptedAnswers:[],level:'A1'};
  values.forEach((v,i)=>{if(!headers[i]&&v)fail(position+'행: 헤더 없는 열입니다.');if(headers[i])row[headers[i]]=headers[i]==='acceptedAnswers'?v.split('|').map(s=>s.trim()).filter(Boolean):v;});
  if(!row.level)row.level='A1';rows.push(row);
 }
 if(!rows.length)fail('선택한 시트에 문장이 없습니다.');
 return {sheets:names,sheet:selected,rows};
}
try{parentPort.postMessage({ok:true,value:main()});}catch(error){parentPort.postMessage({ok:false,error:error instanceof Error?error.message:'파일을 읽을 수 없습니다.'});}
`;
