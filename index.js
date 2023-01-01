import {create} from "ipfs";
import {getDelta,applyDelta} from "little-diff";
import {argWaiter} from "arg-waiter";
import {all} from "@anywhichway/all";

const chunksToBuffer = argWaiter((chunks) => {
    return new Uint8Array(chunks.reduce((buffer,chunk) => {
        buffer = [...buffer,...chunk];
        return buffer;
    },[]))
})

const normalizeContent = argWaiter((value) => {
    if(typeof(value)==="string") {
        return new Uint8Array([...value].map(ch => ch.charCodeAt()));
    }
    return value;
})

const ipvfs = argWaiter((ipfs) => {
    ipfs.files.versioned = {
        async read(path,{withMetadata,withHistory,withRoot}={}) {
            const parts = path.split("/"),
                name = parts.pop(),
                nameParts =  name.includes("@") ? name.split("@") : (name.includes("#") ? name.split("#") : null),
                version = name.includes("@")  ? nameParts.pop() : (name.includes("#") ? parseInt(nameParts.pop()) : null),
                vtype = name.includes("@") ? "@" : (name.includes("#") ? "#" : null),
                buffer = await chunksToBuffer(all(ipfs.files.read(nameParts ? parts.join("/") + "/" + nameParts.pop() : path))),
                data = JSON.parse(String.fromCharCode(...buffer));
            let i = data.length-1;
            if(vtype) {
                i = -1;
                if(vtype==="#") {
                    i = version - 1;
                } else {
                    for(let j=0;j<data.length;j++) { // gets last index in case manual versioning is a bit messed up by users
                        if(data[j].version===version) {
                            i = j;
                        }
                    }
                }
                if(i<0) {
                    throw new Error(`Version ${vtype}${version} not found for ${parts.join("/")}/${name}`)
                }
            }
            const metadata = data[i],
                rootBuffer = await chunksToBuffer(all(ipfs.cat(data[0].path))),
                rootContent = metadata.kind==="String" ? String.fromCharCode(...rootBuffer) : rootBuffer,
                history = data.slice(0,i+1),
                content = history.reduce((targetContent,item) => {
                    return applyDelta(targetContent,item.delta);
                },rootContent);
            if(withMetadata||withHistory||withRoot) {
                const result = {
                    content
                }
                if(withRoot) {
                    result.root = data[0];
                }
                if(withMetadata) {
                    result.metadata = metadata;
                    result.metadata.birthtime = data[0].birthtime;
                }
                if(withHistory) {
                    result.history =  history;
                }
                return result
            }
            return content;
        },
        async write(path,content,{version,...rest}) {
            const kind = content.constructor.name;
            //content = await normalizeContent(content);
            const parts = path.split("/"),
                name = parts.pop(),
                dir = parts.join("/") + "/",
                files = await all(ipfs.files.ls(dir)),
                file = files.find((file) => file.name===name);
            if(file) {
                const buffer = await chunksToBuffer(all(ipfs.files.read(path))),
                    data = JSON.parse(String.fromCharCode(...buffer)),
                    parent = data[data.length-1],
                    rootBuffer = await chunksToBuffer(all(ipfs.cat(data[0].path))),
                    rootContent = kind==="String" ? String.fromCharCode(...rootBuffer) : rootBuffer,
                    parentContent = data.reduce((parentContent,item) => {
                        return applyDelta(parentContent,item.delta);
                    },rootContent),
                    delta = getDelta(parentContent,content);
                if(delta.length>0 || (version!==undefined && version!==parent.version) || Object.entries(rest).some(([key,value]) => parent[key]!==value)) {
                    data.push({
                        version:version||data.length+1,
                        kind,
                        ...rest,
                        delta,
                        ctime: Date.now()
                    })
                    await ipfs.files.rm(path); // write sometimes fails to flush tail of file, so simply delete and re-create
                    await ipfs.files.write(path,JSON.stringify(data),{create:true});
                }
                return;
            }
            const added = await ipfs.add(content),
                now = Date.now(),
                data = [{path:added.path,version:version||1,kind,...rest,delta:[],birthtime:now,ctime:now}];
            await ipfs.files.write(path,JSON.stringify(data),{create:true});
        }
    }
    return ipfs;
});

export {ipvfs,ipvfs as default}

