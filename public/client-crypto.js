"use strict";

(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.GraduationCrypto=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  function randomId(){
    const bytes=new Uint8Array(16),cryptoApi=typeof globalThis!=="undefined"?globalThis.crypto:null;
    if(cryptoApi?.getRandomValues)cryptoApi.getRandomValues(bytes);
    else for(let index=0;index<bytes.length;index++)bytes[index]=Math.floor(Math.random()*256);
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const hex=[...bytes].map(value=>value.toString(16).padStart(2,"0"));
    return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10).join("")}`;
  }

  function sha256Hex(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    const bitLength=bytes.length*8,paddedLength=((bytes.length+9+63)>>6)<<6,data=new Uint8Array(paddedLength);
    data.set(bytes);data[bytes.length]=128;
    const view=new DataView(data.buffer);
    view.setUint32(paddedLength-8,Math.floor(bitLength/0x100000000),false);
    view.setUint32(paddedLength-4,bitLength>>>0,false);
    const constants=new Uint32Array(64),words=new Uint32Array(64);
    let prime=2,found=0;
    while(found<64){
      let isPrime=true;
      for(let divisor=2;divisor*divisor<=prime;divisor++)if(prime%divisor===0){isPrime=false;break}
      if(isPrime)constants[found++]=Math.floor((Math.cbrt(prime)%1)*0x100000000)>>>0;
      prime++;
    }
    const initial=[2,3,5,7,11,13,17,19].map(value=>Math.floor((Math.sqrt(value)%1)*0x100000000)>>>0);
    const hash=new Uint32Array(initial);
    const rotate=(value,count)=>(value>>>count)|(value<<(32-count));
    for(let offset=0;offset<data.length;offset+=64){
      for(let index=0;index<16;index++)words[index]=view.getUint32(offset+index*4,false);
      for(let index=16;index<64;index++){
        const a=words[index-15],b=words[index-2];
        const s0=rotate(a,7)^rotate(a,18)^(a>>>3),s1=rotate(b,17)^rotate(b,19)^(b>>>10);
        words[index]=(words[index-16]+s0+words[index-7]+s1)>>>0;
      }
      let [a,b,c,d,e,f,g,h]=hash;
      for(let index=0;index<64;index++){
        const s1=rotate(e,6)^rotate(e,11)^rotate(e,25),choice=(e&f)^(~e&g);
        const t1=(h+s1+choice+constants[index]+words[index])>>>0;
        const s0=rotate(a,2)^rotate(a,13)^rotate(a,22),majority=(a&b)^(a&c)^(b&c);
        const t2=(s0+majority)>>>0;
        h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      hash[0]=(hash[0]+a)>>>0;hash[1]=(hash[1]+b)>>>0;hash[2]=(hash[2]+c)>>>0;hash[3]=(hash[3]+d)>>>0;
      hash[4]=(hash[4]+e)>>>0;hash[5]=(hash[5]+f)>>>0;hash[6]=(hash[6]+g)>>>0;hash[7]=(hash[7]+h)>>>0;
    }
    return [...hash].map(value=>value.toString(16).padStart(8,"0")).join("");
  }
  return{randomId,sha256Hex};
});
