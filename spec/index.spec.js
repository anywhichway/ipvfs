import ipvfs from "../index.js";
import {create} from "ipfs";
import {all} from "@anywhichway/all";


describe("main tests", () => {
    let ipfs;
    beforeAll(async () => {
        ipfs = await ipvfs(create());
        try {
            await ipfs.files.rm("/",{recursive:true,flush:true});
        } catch(e) {

        }
    },10000)

    const randomFileName = () => {
        return (Math.random()+"").substring(2)+".txt";
    }

    it("write file",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBe("test");
    })
    it("write file containing Object",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname, {name:"test"});
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBeInstanceOf(Object);
        expect(result.name).toBe("test");
    })
    it("write file asBase",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test1");
        await ipfs.files.versioned.write("/"+fname,"test2",{asBase:true});
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBe("test2");
    })
    it("read file",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBe("test");
    })
    it("read file with...",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname,{all:true,withMetadata:true,withHistory:true,withRoot:true});
        expect(result.content).toBe("test");
        expect(result.metadata).toBeInstanceOf(Object);
        expect(result.history).toBeInstanceOf(Array);
        expect(JSON.stringify(result.root)).toBe(JSON.stringify(result.history[0]))
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
    it("read file by # - not number",async () => {
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
    it("read file by # - version not found",async () => {
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
    it("read file by @",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test",{metadata:{version:"1.0.0"}});
        const result = await ipfs.files.versioned.read("/"+fname+"@1.0.0",{all:true});
        expect(result).toBe("test");
    });
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
    },20*1000)
})






