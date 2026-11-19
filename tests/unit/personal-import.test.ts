import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute } from 'node:path';
import { crc32,deflateRawSync } from 'node:zlib';
import { describe,it,expect } from 'vitest';
import { parsePersonalTxt } from '@/server/imports/txt';
import { parsePersonalXlsx } from '@/server/imports/xlsx';
import { resolveXlsxSaxPath } from '@/server/imports/xlsx-sax-path';
import { readPersonalUpload } from '@/server/imports/read-upload';
const enc=new TextEncoder();
function zip(files:Record<string,string>){const data:Buffer[]=[],central:Buffer[]=[];let offset=0;for(const [name,text] of Object.entries(files)){const n=Buffer.from(name),raw=Buffer.from(text),compressed=deflateRawSync(raw),local=Buffer.alloc(30),entry=Buffer.alloc(46);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(8,8);local.writeUInt32LE(crc32(raw),14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(n.length,26);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,6);entry.writeUInt16LE(8,10);entry.writeUInt32LE(crc32(raw),16);entry.writeUInt32LE(compressed.length,20);entry.writeUInt32LE(raw.length,24);entry.writeUInt16LE(n.length,28);entry.writeUInt32LE(offset,42);data.push(local,n,compressed);central.push(entry,n);offset+=local.length+n.length+compressed.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...data,directory,end]);}
function book(cell='<c r="A2" t="inlineStr"><is><t>질문</t></is></c><c r="B2" t="inlineStr"><is><t>Answer</t></is></c>',extra:Record<string,string>={}){return zip({'[Content_Types].xml':'<Types/>','xl/workbook.xml':'<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="One" r:id="s1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>','xl/worksheets/sheet1.xml':`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>prompt</t></is></c><c r="B1" t="inlineStr"><is><t>target</t></is></c></row><row r="2">${cell}</row></sheetData></worksheet>`,...extra});}
describe('personal TXT',()=>{
 it('supports UTF-8 BOM CRLF, blank lines and explicit TSV with no header',()=>{const rows=parsePersonalTxt(enc.encode('\uFEFF질문\tAnswer\t보조\r\n\r\n다음\tNext\t설명'),'TSV');expect(rows.map(r=>r.row)).toEqual([1,3]);expect(rows[0]).toMatchObject({prompt:'질문',target:'Answer',meaning:'보조'});});
 it('imports English-only rows as target with missing prompt',()=>{expect(parsePersonalTxt(enc.encode('Hello\n'),'LINES')[0]).toMatchObject({target:'Hello',prompt:''});});
 it.each([new Uint8Array([0xc3,0x28]),enc.encode('Hi\0'),enc.encode('a\rb')])('rejects invalid UTF8/NUL/CR',(bytes)=>{expect(()=>parsePersonalTxt(bytes,'LINES')).toThrow();});
 it('rejects mixed TSV widths, more than 100 rows and oversized cells',()=>{expect(()=>parsePersonalTxt(enc.encode('질문\tA\n질문\tB\tC'),'TSV')).toThrow();expect(()=>parsePersonalTxt(enc.encode(Array(101).fill('Hi').join('\n')),'LINES')).toThrow();expect(()=>parsePersonalTxt(enc.encode('a'.repeat(4001)),'LINES')).toThrow();});
});
describe('bounded XLSX',()=>{
 it('resolves a real absolute dependency filename usable by an unbundled worker',()=>{
  const path=resolveXlsxSaxPath();
  expect(typeof path).toBe('string');expect(isAbsolute(path)).toBe(true);
  const sax=createRequire(import.meta.url)(path);
  expect(typeof sax.parser).toBe('function');
  expect(sax.parser(true)).toBeDefined();
 });
 it('reads the real downloadable XLSX template',async()=>{const result=await parsePersonalXlsx(readFileSync('public/templates/personal-sentences.xlsx'));expect(result.rows).toHaveLength(2);expect(result.rows[0]).toMatchObject({prompt:'영수증을 요청한다',target:'Can I get a receipt?'});});
 it('reads static inline strings',async()=>expect((await parsePersonalXlsx(book())).rows[0]).toMatchObject({prompt:'질문',target:'Answer'}));
 it.each(['<c r="A2"><f>1+1</f><v>2</v></c>','<c r="A2" t="e"><v>#REF!</v></c>','<c r="H2" t="inlineStr"><is><t>Wide</t></is></c>','<mergeCell ref="A2:B2"/>','<hyperlink ref="A2"/>'])('rejects formulas/cache, errors, wide and merged/link cells',async cell=>{await expect(parsePersonalXlsx(book(cell))).rejects.toMatchObject({status:422});});
 it('rejects external relationship and macro parts',async()=>{await expect(parsePersonalXlsx(book(undefined,{'xl/_rels/other.xml.rels':'<Relationships><Relationship TargetMode="External" Target="https://invalid.test"/></Relationships>'}))).rejects.toMatchObject({status:422});await expect(parsePersonalXlsx(book(undefined,{'xl/vbaProject.bin':'bad'}))).rejects.toMatchObject({status:422});});
 it('rejects DTD/entity, malformed XML and oversized metadata before parsing contents',async()=>{for(const value of ['<!DOCTYPE x [<!ENTITY a "boom">]><x>&a;</x>','<x>','<x>&#0;</x>','<x>'+ 'a'.repeat(4*1024*1024)+'</x>'])await expect(parsePersonalXlsx(book(undefined,{'docProps/evil.xml':value}))).rejects.toMatchObject({status:422});});
 it('bounds total ZIP expansion and entry count',async()=>{const parts:Record<string,string>={};for(let i=0;i<5;i++)parts[`docProps/large${i}.xml`]='<x>'+ 'a'.repeat(3500000)+'</x>';await expect(parsePersonalXlsx(book(undefined,parts))).rejects.toMatchObject({status:422});const entries:Record<string,string>={};for(let i=0;i<201;i++)entries[`docProps/${i}.xml`]='<x/>';await expect(parsePersonalXlsx(book(undefined,entries))).rejects.toMatchObject({status:422});});
 it('rejects traversal and damaged archives',async()=>{await expect(parsePersonalXlsx(book(undefined,{'../evil.xml':'<x/>'}))).rejects.toMatchObject({status:422});await expect(parsePersonalXlsx(new Uint8Array([1,2,3]))).rejects.toMatchObject({status:422});});
 it('requires an explicit selection for multiple sheets',async()=>{const bytes=book(undefined,{'xl/workbook.xml':'<workbook xmlns:r="urn:r"><sheets><sheet name="One" r:id="s1"/><sheet name="Two" r:id="s2"/></sheets></workbook>'});const result=await parsePersonalXlsx(bytes);expect(result.sheets).toEqual(['One','Two']);expect(result.rows).toEqual([]);expect((await parsePersonalXlsx(bytes,'One')).rows).toHaveLength(1);});
});
describe('bounded multipart',()=>{
 it('checks actual stream bytes before FormData allocation',async()=>{const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(2*1024*1024+65537));c.close();}});const request=new Request('http://local.test',{method:'POST',headers:{'content-type':'multipart/form-data; boundary=x'},body,duplex:'half'} as RequestInit);await expect(readPersonalUpload(request)).rejects.toMatchObject({status:413});});
 it.each(['old.xls','macro.xlsm'])('rejects unsupported %s',async name=>{const form=new FormData();form.set('file',new File(['abc'],name));await expect(readPersonalUpload(new Request('http://local.test',{method:'POST',body:form}))).rejects.toMatchObject({status:415});});
});
