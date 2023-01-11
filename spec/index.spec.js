import { performance } from "node:perf_hooks";
import process from "node:process";
import ipvfs from "../index.js";
import {create} from "ipfs";
import {all} from "@anywhichway/all";

const metrics = {};

const objectDelta = (start,finish) => {
    return Object.entries(start).reduce((delta,[key,value]) => {
        if(typeof(value)==="number" && typeof(finish[key])==="number") {
            delta[key] = finish[key] - value;
        }
        return delta;
    },{})
}

const objectDeltaPercent = (start,finish) => {
    return Object.entries(start).reduce((delta,[key,value]) => {
        if(typeof(value)==="number" && typeof(finish[key])==="number") {
            const change = finish[key] / value;
            if(change===1) {
                delta[key] = 0;
            } else if(change>1) {
                delta[key] = Math.round(((change - 1) * 100));
            } else {
                delta[key] = Math.round(((1 - change) * -100));
            }
        }
        return delta;
    },{})
}

const _it = it;
it = function(name,f,timeout,cycles=1) {
    const _f = f,
        sampleMetrics = [];
    f = async function(...args)  {
        let cycle = 1;
        while(cycle<=cycles) {
            const sample = {
                cycle,
                cpu: {
                    start: process.cpuUsage()
                },
                memory: {
                    start: process.memoryUsage()
                }
            }
            await _f(...args);
            sample.cpu.finish = process.cpuUsage();
            sample.memory.finish = process.memoryUsage();
            sample.cpu.delta = objectDelta(sample.cpu.start,sample.cpu.finish);
            sample.memory.delta = objectDelta(sample.memory.start,sample.memory.finish);
            sample.cpu.pctChange = objectDeltaPercent(sample.cpu.start,sample.cpu.finish);
            sample.memory.pctChange = objectDeltaPercent(sample.memory.start,sample.memory.finish);
            sampleMetrics.push(sample);
            cycle++;
        }
    };
    const spec = _it(name,f,timeout),
        fullName = spec.getFullName();
    metrics[fullName] = sampleMetrics;
}
describe("main tests", () => {
    let ipfs;
    beforeAll(async () => {
        ipfs = await ipvfs(create());
        try {
            await ipfs.files.rm("/",{recursive:true,flush:true});
        } catch(e) {

        }
    },12000)

    const randomFileName = () => {
        return (Math.random()+"").substring(2)+".txt";
    }

    it("write/read file",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBe("test");
    },null,5)
    it("write/read file non-symbolic version Error 1",async () => {
        const fname = randomFileName();
        let result;
        try {
            await ipfs.files.versioned.write("/"+fname,"test",{metadata:{version:"1"}});
        } catch(e) {
            result = e;
        }
        expect(result).toBeInstanceOf(Error);
    })
    it("write/read file non-symbolic version Error 2",async () => {
        const fname = randomFileName();
        let result;
        try {
            await ipfs.files.versioned.write("/"+fname,"test",{metadata:{version:"1.0"}});
        } catch(e) {
            result = e;
        }
        expect(result).toBeInstanceOf(Error);
    })
    it("publish file",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test1");
        await ipfs.files.versioned.write("/"+fname,"test2");
        const cid = await ipfs.files.versioned.publish("/"+fname+"#1"),
            path = `https://ipfs.io/ipfs/${cid}`,
            result = await ipfs.files.versioned.read("/"+fname,{all:true,withHistory:true}),
            response = await fetch(path);
        expect(result.content).toBe("test1");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("test1");
    })
    it("write file containing Object",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname, {name:"test"});
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBeInstanceOf(Object);
        expect(result.name).toBe("test");
    })
    it("write file with @ version",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test",{metadata:{version:"1.0.0"}});
        const result = await ipfs.files.versioned.read("/"+fname+"@1.0.0",{all:true});
        expect(result).toBe("test");
    })
    it("write file with @ version in path",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname+"@1.0.0","test");
        const result = await ipfs.files.versioned.read("/"+fname+"@1.0.0",{all:true});
        expect(result).toBe("test");
    })
    it("write file with @ version in path and arg",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname+"@1.0.0","test",{metadata:{version:"1.0.1"}});
        const result = await ipfs.files.versioned.read("/"+fname+"@1.0.0",{all:true});
        try {
            await ipfs.files.versioned.read("/" + fname + "@1.0.1", {all: true});
        } catch(e) {
            expect(e).toBeInstanceOf(Error)
        }
        expect(result).toBe("test");
    })
    it("write file with # version in path same content",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        await ipfs.files.versioned.write("/"+fname+"#1","test");
        const result = await ipfs.files.versioned.read("/"+fname,{all:true,withHistory:true});
        expect(result.content).toBe("test");
        expect(result.history.length).toBe(1);
    })
    it("write file with # version in path same content bad version Error",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        try {
            await ipfs.files.versioned.write("/"+fname+"#q","test");
        } catch(e) {
            expect(e).toBeInstanceOf(Error);
        }
        const result = await ipfs.files.versioned.read("/"+fname,{all:true,withHistory:true});
        expect(result.content).toBe("test");
        expect(result.history.length).toBe(1);
    })
    it("write file with # version in path different content Error",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test1");
        let result;
        try {
            await ipfs.files.versioned.write("/"+fname+"#1","test2");
        } catch(e) {
            result = e;
        }
        expect(result).toBeInstanceOf(Error);
    })
    it("write file with # version in path same content non-publish metadata Error",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        let result;
        try {
            await ipfs.files.versioned.write("/"+fname+"#1","test",{metadata:{author:"joe"}});
        } catch(e) {
            result = e;
        }
        expect(result).toBeInstanceOf(Error);
    })
    it("write file with # version in path same content invalid publish metadata Error",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        let result;
        try {
            await ipfs.files.versioned.write("/"+fname+"#1","test",{metadata:{published:{cid:"",version:1,hash:""}}});
        } catch(e) {
            result = e;
        }
        expect(result).toBeInstanceOf(TypeError);
    })
    it("write file asBase",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test1");
        await ipfs.files.versioned.write("/"+fname,"test2",{asBase:true});
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBe("test2");
    })
    it("read file with...",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname,{all:true,withMetadata:true,withHistory:true,withRoot:true});
        expect(result.content).toBe("test");
        expect(result.metadata).toBeInstanceOf(Object);
        expect(result.history).toBeInstanceOf(Array);
        expect(JSON.stringify(result.root)).toBe(JSON.stringify(result.history[0]))
        const path = `https://ipfs.io/ipfs/${result.root.path}`,
            response = await fetch(path);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("test");
    })
    it("read file as stream",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        let result = "";
        for await(const chunk of await ipfs.files.versioned.read("/"+fname)) {
            result += chunk.toString();
        };
        expect(result).toBe(result);
    })
    it("read file by #",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname+"#1",{all:true});
        expect(result).toBe("test");
    })
    it("read file by # - not number Error",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        let result;
        try {
            await ipfs.files.versioned.read("/"+fname+"#a",{all:true});
        } catch(e) {
            result = e;
        }
        expect(result).toBeInstanceOf(Error);
        expect(result.message.includes("not number"));
    })
    it("read file by # - version not found Error",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        let result;
        try {
            await ipfs.files.versioned.read("/"+fname+"#10",{all:true});
        } catch(e) {
            result = e;
        }
        expect(result).toBeInstanceOf(Error);
        expect(result.message.includes("not found"))
    })
    it("rebase",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test1");
        await ipfs.files.versioned.write("/"+fname,"test2");
        await ipfs.files.versioned.write("/"+fname,"test32");
        const result1 = await ipfs.files.versioned.read("/"+fname+"#1",{all:true}),
            result2 = await ipfs.files.versioned.read("/"+fname+"#2",{all:true});
        expect(result1).toBe("test1");
        expect(result2).toBe("test2");
        await ipfs.files.versioned.rebase("/"+fname+"#2",);
        const rebased1 = await ipfs.files.versioned.read("/"+fname+"#1",{all:true}),
            rebased2 = await ipfs.files.versioned.read("/"+fname+"#1",{all:true});
        expect(rebased1).toBe("test2");
        expect(rebased2).toBe("test2");
    })
    it("handle large file", async () => {
        const text = "".padStart(1024,"a"),
            fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,text);
        let content = [...await ipfs.files.versioned.read("/"+fname,{all:true})];
        for(let i=0;i<50;i++) {
            const random = Math.round(Math.random()*1000);
            content[random] = "b";
            if(random % 2 === 0) {
                content = content.reverse()
            } else {
                content = [...content,..."".padStart(1024,"c").split("")];
            }
            await ipfs.files.versioned.write("/"+fname,content.join(""));
        }
        content = "";
        let i= 0;
        for await(const chunk of await ipfs.files.versioned.read("/"+fname)) {
            content += chunk.toString();
            i++;
        }
        expect(i).toBeGreaterThan(1);
        expect(content.length).toBeGreaterThan(1024);
        expect(content.includes("b")).toBe(true);
        expect(content.includes("c")).toBe(true);
    },25*1000)

    afterAll(() => {
        //console.log(JSON.stringify(metrics,null,2));
    })
})






