export function mediaNameParts(name:string){
 const dot=name.lastIndexOf('.');
 return dot>0?{base:name.slice(0,dot),extension:name.slice(dot)}:{base:name,extension:''};
}
