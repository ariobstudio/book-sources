// Copyright (c) 2026 Ariob Studio. Apache-2.0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runSearch, runChapters, runPages } from '../engine.mjs';
const source = async id => JSON.parse(await readFile(new URL(`../sources/${id}.source.json`, import.meta.url)));
const uuid = '11111111-1111-4111-a111-111111111111';
const host = body => ({ request: async (url) => ({status: 200, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body)}) });
test('MangaDex preserves language and group editions, paginates raw results and excludes external or future chapters', async () => {
 const s = await source('mangadex'); const calls=[];
 const rows = [{id:'en',attributes:{chapter:'2',pages:20,translatedLanguage:'en'},relationships:[{type:'scanlation_group',attributes:{name:'Group A'}}]}, {id:'ja',attributes:{chapter:'2',pages:20,translatedLanguage:'ja'}}, {id:'external',attributes:{pages:20,externalUrl:'https://publisher.test/'}}, {id:'future',attributes:{pages:20,publishAt:'2099-01-01T00:00:00Z'}}];
 const h=host({data:rows,total:101}); const request=h.request;h.request=(u,o)=>{calls.push(u);return request(u,o)};
 const p=await runChapters(s,{id:uuid},2,h);
 assert.deepEqual(p.items.map(i=>i.id),['en','ja']);assert.equal(p.items[0].group,'Group A');assert.equal(p.hasMore,true);assert.match(calls[0],/offset=50/);
});
test('original MangaDex page order wins over filenames and data-saver alternatives',async()=>{
 const s=await source('mangadex'); const pages=await runPages(s,{id:uuid},host({baseUrl:'https://node.mangadex.network/token',chapter:{hash:'hash',data:['10.jpg','2.png'],dataSaver:['compressed.jpg']}}));
 assert.deepEqual(pages.map(i=>new URL(i.url).pathname),['/token/data/hash/10.jpg','/token/data/hash/2.png']);assert.equal(pages[0].report,true);
 await assert.rejects(runPages(s,{id:uuid},host({chapter:{data:[]}})),/no downloadable/);
});
test('WEBTOON keeps episode order across pagination, preserves original image order, and refuses locked episodes',async()=>{
 const s=await source('webtoons');
 const results=await runSearch(s,'sky',1,host('<a href="/en/fantasy/sky/list?title_no=7"><strong class="title">Sky &amp; Sea</strong><div class="author">Artist</div><img src="https://image.test/cover.jpg"></a>'));
 assert.equal(results.items[0].title,'Sky & Sea');assert.equal(results.items[0].direction,'ltr');assert.equal(results.items[0].delivery,'chapters');
 const ch=await runChapters(s,results.items[0],1,host('<li class="_episodeItem" data-episode-no="3"><a href="/en/fantasy/sky/ep3/viewer?title_no=7&amp;episode_no=3"><span class="subj">Episode 3</span></a></li><a href="?title_no=7&amp;page=2">Next</a>'));
 assert.equal(ch.hasMore,true);assert.equal(ch.items[0].number,'3');
 const pages=await runPages(s,ch.items[0],host('<img class="ad" src="https://ad.test/ad.jpg"><img data-url="https://image.test/z.jpg?a=1&amp;b=2" class="_images"><img class="_images" data-url="https://image.test/a.png">'));
 assert.deepEqual(pages.map(p=>p.url),['https://image.test/z.jpg?a=1&b=2','https://image.test/a.png']);assert.match(pages[0].headers.Referer,/episode_no=3/);
 await assert.rejects(runPages(s,ch.items[0],host('<p>Open in the app</p>')),/locked/);
});
