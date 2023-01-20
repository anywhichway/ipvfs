import benchtest from "benchtest";

it = benchtest(it);
import ipvfs from "../index.js";
import {create} from "ipfs";

const garbage = [];
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

    const metrics = {pendingPromises: true,activeResources:true, sample:{size:10,performance:true}}; /// sample:{size:100,memory:true, cpu:true, performance:true},
    it("ipfs write/read file",async () => {
        const fname = randomFileName();
        await ipfs.files.write("/"+fname,"test",{create:true});
        let result = "";
        for await(const chunk of await ipfs.files.read("/"+fname)) {
            result += chunk.toString();
        }
        expect(result).toBe("test");
    },{metrics,timemout:10000})
    it("write/read file",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBe("test");
    },{metrics,timemout:10000})
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
    it("publish file to mutable file system",async () => {
        const fname = randomFileName(),
            mfname = "/test-" + fname;
        await ipfs.files.versioned.write("/"+fname,"test1");
        await ipfs.files.versioned.write("/"+fname,"test2");
        await ipfs.files.versioned.publish("/"+fname+"#1",mfname);
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        let text = "";
        for await(const chunk of await ipfs.files.read(mfname)) {
            text += chunk.toString();
        }
        expect(result).toBe("test1");
        expect(text).toBe("test1");
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
        }
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
        const metrics = benchtest.metrics(),
            summary = benchtest.summarize(metrics),
            i = benchtest.issues(summary);
       // console.log("Metrics:",JSON.stringify(metrics,null,2));
       // console.log("Summary:",JSON.stringify(summary,null,2));
        console.log("Issues:",JSON.stringify(i,null,2));
    })
})






