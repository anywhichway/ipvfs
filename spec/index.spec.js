import ipvfs from "../index.js";
import {create} from "ipfs";


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

    it("create file",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBe(result);
    })
    it("get file by #",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname+"#1",{all:true});
        expect(result).toBe(result);
    })
    it("get file by @",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test",{metadata:{version:"1.0.0"}});
        const result = await ipfs.files.versioned.read("/"+fname+"@1.0.0",{all:true});
        expect(result).toBe("test");
    })
    it("rebase",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test1");
        await ipfs.files.versioned.write("/"+fname,"test2");
        const result1 = await ipfs.files.versioned.read("/"+fname+"#1",{all:true}),
            result2 = await ipfs.files.versioned.read("/"+fname+"#2",{all:true});
        expect(result1).toBe("test1");
        expect(result2).toBe("test2");
        await ipfs.files.versioned.rebase("/"+fname+"#2",);
        const rebased = await ipfs.files.versioned.read("/"+fname+"#1",{all:true});
        expect(rebased).toBe("test2");
    })
})






