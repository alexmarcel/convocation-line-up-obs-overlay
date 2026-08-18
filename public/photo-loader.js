"use strict";
(function(root, factory) {
  const PhotoLoader = factory();
  if (typeof module === "object" && module.exports) module.exports = PhotoLoader;
  if (root) root.SafePhotoLoader = PhotoLoader;
})(typeof window !== "undefined" ? window : null, function() {
  return class SafePhotoLoader {
    constructor({ image, loadAsset, revoke = url => URL.revokeObjectURL(url) }) {
      this.image=image;this.loadAsset=loadAsset;this.revoke=revoke;this.generation=0;this.activeUrl=null;
      this.hide(false);
    }
    hide(invalidate=true) {
      if(invalidate)this.generation++;
      this.image.onload=null;this.image.onerror=null;this.image.classList.add("photo-unavailable");this.image.removeAttribute("src");
      if(this.activeUrl){this.revoke(this.activeUrl);this.activeUrl=null}
    }
    begin() { this.generation++;this.hide(false);return this.generation; }
    async load(kind,id,generation) {
      let url="";
      try{
        url=await this.loadAsset(kind,id);
        if(!url||generation!==this.generation){if(url)this.revoke(url);return false}
        this.image.src=url;
        await this.image.decode();
        if(generation!==this.generation){this.revoke(url);return false}
        this.activeUrl=url;this.image.classList.remove("photo-unavailable");return true;
      }catch{
        if(url)this.revoke(url);
        if(generation===this.generation)this.hide(false);
        return false;
      }
    }
    reset() { this.hide(true); }
  };
});
