import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeUrl, publicFormats, youtubeProgress } from '../app/youtube.mjs';
test('direct HTTPS formats win over HLS at the same resolution; HLS only fills gaps',()=>{
 const data={title:'T',duration:10,formats:[
  {format_id:'140',ext:'m4a',acodec:'aac',protocol:'https',filesize:100,abr:128},
  {format_id:'232',ext:'mp4',height:720,vcodec:'avc1',acodec:'none',protocol:'m3u8_native',tbr:1669},
  {format_id:'136',ext:'mp4',height:720,vcodec:'avc1',acodec:'none',protocol:'https',tbr:966,filesize:1000},
  {format_id:'623',ext:'mp4',height:1440,vcodec:'vp09',acodec:'none',protocol:'m3u8_native',tbr:5000}]};
 const f=publicFormats(data).formats;
 assert.deepEqual(f.map(x=>x.formatId),['623+140','136+140']);
 assert.equal(f[1].size,1100);assert.equal(f[1].sizeEstimated,false);
});
test('progress combines video + audio files into one fixed total',()=>{
 const seen=[];const line=youtubeProgress(p=>seen.push(p));
 line('ZIVAR-SIZE:[1000, 200]:NA');
 line('ZIVAR:'+JSON.stringify({filename:'v.f137.mp4',downloaded_bytes:500,total_bytes:1000,speed:10}));
 line('ZIVAR:'+JSON.stringify({filename:'v.f137.mp4',downloaded_bytes:1000,total_bytes:1000,status:'finished'}));
 line('ZIVAR:'+JSON.stringify({filename:'v.f140.m4a',downloaded_bytes:100,total_bytes:200}));
 assert.deepEqual(seen.map(p=>[p.received,p.total,p.estimated]),[[500,1200,false],[1000,1200,false],[1100,1200,false]]);
 const hls=[];const l2=youtubeProgress(p=>hls.push(p));
 l2('ZIVAR-SIZE:NA:NA');l2('ZIVAR:'+JSON.stringify({filename:'a',downloaded_bytes:50,total_bytes_estimate:400}));
 assert.deepEqual([hls[0].total,hls[0].estimated],[400,true]);
});
test('YouTube links normalize one video and reject foreign hosts and credentials',()=>{
 assert.equal(youtubeUrl('https://www.youtube.com/watch?v=Io0fBr1XBUA&list=RDxxx'),'https://www.youtube.com/watch?v=Io0fBr1XBUA');
 assert.equal(youtubeUrl('https://youtu.be/Io0fBr1XBUA'),'https://www.youtube.com/watch?v=Io0fBr1XBUA');
 for(const u of ['https://youtube.com.evil.test/watch?v=Io0fBr1XBUA','file:///video','https://u:p@youtube.com/watch?v=Io0fBr1XBUA','https://youtube.com/playlist?list=xxx'])assert.equal(youtubeUrl(u),null);
});
test('formats combine audio, exclude DRM and avoid reporting audio-only size as whole video',()=>{
 const data={title:'Test',duration:10,formats:[{format_id:'140',ext:'m4a',acodec:'aac',filesize:1000,tbr:128},{format_id:'137',ext:'mp4',height:1080,vcodec:'h264',acodec:'none',tbr:1000},{format_id:'999',ext:'mp4',height:2160,vcodec:'h264',has_drm:true}]};
 const result=publicFormats(data);assert.equal(result.formats.length,1);assert.equal(result.formats[0].formatId,'137+140');assert.equal(result.formats[0].size,1251000);assert.equal(result.formats[0].sizeEstimated,true);
 assert.throws(()=>publicFormats({...data,is_live:true}),/Live/);
});
