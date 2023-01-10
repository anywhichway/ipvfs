import { performance } from "node:perf_hooks";
import process from "node:process";
import assert from "node:assert";
import ipvfs from "./index.js";
import {create} from "ipfs";

class TimeoutError extends Error {
    constructor(expected,message) {
        super(`Did not get a response in: ${expected}ms.${message ? " " + message : ""}`);
    }
}

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
                delta[key] = 0 + "%";
            } else if(change>1) {
                delta[key] = Math.round(((change - 1) * 100)) + "%";
            } else {
                delta[key] = Math.round(((1 - change) * -100)) + "%";
            }
        }
        return delta;
    },{})
}

const tests = [],
    results = {};

const suite = {
    cycles: 1,
    timeout: 0,
    cpu: {
        start: process.cpuUsage()
    },
    memory: {
        start: process.memoryUsage()
    }
};
Object.defineProperty(suite,"results",{value:{}});

const context = {

}

const beforeAll = async () => {
    const ipfs = await ipvfs(create());
    try {
        await ipfs.files.rm("/",{recursive:true,flush:true});
    } catch(e) {

    }
    context.ipfs = ipfs
}

const test = (name,f,{cycles,timeout,limits={}}={}) => {
    cycles ||= suite.cycles || 1;
    timeout ||= suite.timeout || 0;
    const promise = new Promise(async (resolve) => {
        const result = results[name] ||= [];
        while(cycles-->0) {
            const sample = {
                    cycle: cycles+1,
                    cpu: {
                        start: process.cpuUsage()
                    },
                    memory: {
                        start: process.memoryUsage()
                    }
                },
                index = result.length;
            if(timeout) {
                setTimeout(() => {
                    sample.finish = performance.now();
                    sample.duraction = sample.finish - sample.start;
                    sample.passed = false;
                    sample.result = new TimeoutError(timeout);
                    sample.cpu.finish = process.cpuUsage(sample.cpu.start);
                    sample.cpu.delta = objectDelta(sample.cpu.start,sample.cpu.finish);
                    sample.cpu.pctDelta = objectDeltaPercent(sample.cpu.start,sample.cpu.finish);
                    sample.memory.finish = process.memoryUsage();
                    sample.memory.delta = objectDelta(sample.memory.start,sample.memory.finish);
                    sample.memory.pctDelta = objectDeltaPercent(sample.memory.start,sample.memory.finish);
                    result[index] = sample;
                    console.error(`${name}[${cycles+1}].passed == ${sample.passed}`);
                    suite.results[name] = "failed";
                    if(cycles===0) {
                        resolve(limits);
                    }
                })
            }
            sample.start = performance.now();
            try {
                const returned = await f();
                if(!result[index]) {
                    sample.finish = performance.now();
                    sample.duraction = sample.finish - sample.start;
                    sample.passed = true;
                    sample.result = returned;
                    if(!suite.results[name]) {
                        suite.results[name] = "passed";
                    }
                }
            } catch(e) {
                if(!result[index]) {
                    sample.finish = performance.now();
                    sample.duraction = sample.finish - sample.start;
                    sample.passed = false;
                    suite.results[name] = "failed";
                    sample.result = e;
                }
            } finally {
                sample.cpu.finish = process.cpuUsage(sample.cpu.start);
                sample.cpu.delta = objectDelta(sample.cpu.start,sample.cpu.finish);
                sample.cpu.pctDelta = objectDeltaPercent(sample.cpu.start,sample.cpu.finish);
                sample.memory.finish = process.memoryUsage();
                sample.memory.delta = objectDelta(sample.memory.start,sample.memory.finish);
                sample.memory.pctDelta = objectDeltaPercent(sample.memory.start,sample.memory.finish);
                result[index] = sample;
                if(!sample.passed) {
                    console.error(`${name}[${cycles+1}].passed == ${sample.passed}, ${sample.result}`)
                }
            }
        }
        resolve(limits)
    })
    tests.push(promise)
}

await beforeAll();

const randomFileName = () => {
    return (Math.random()+"").substring(2)+".txt";
}

test("create file",async () => {
    const ipfs = context.ipfs,
        fname = randomFileName();
    await ipfs.files.versioned.write("/"+fname,"test");
    const result = await ipfs.files.versioned.read("/"+fname,{all:true});
    assert.strictEqual("test",result);
})
test("get file by #",async () => {
    const ipfs = context.ipfs,
        fname = randomFileName();
    await ipfs.files.versioned.write("/"+fname,"test");
    const result = await ipfs.files.versioned.read("/"+fname+"#1",{all:true});
    assert.strictEqual("test",result);
})
test("get file by @",async () => {
    const ipfs = context.ipfs,
        fname = randomFileName();
    await ipfs.files.versioned.write("/"+fname,"test",{metadata:{version:"1.0.0"}});
    const result = await ipfs.files.versioned.read("/"+fname+"@1.0.0",{all:true});
    assert.strictEqual("test","test");
})
test("rebase",async () => {
    const ipfs = context.ipfs,
        fname = randomFileName();
    await ipfs.files.versioned.write("/"+fname,"test1");
    await ipfs.files.versioned.write("/"+fname,"test2");
    const result1 = await ipfs.files.versioned.read("/"+fname+"#1",{all:true}),
        result2 = await ipfs.files.versioned.read("/"+fname+"#2",{all:true});
    assert.strictEqual("test1",result1);
    assert.strictEqual("test2",result2);
    await ipfs.files.versioned.rebase("/"+fname+"#2",);
    const rebased = await ipfs.files.versioned.read("/"+fname+"#1",{all:true});
    assert.strictEqual("test2",rebased);
})

Promise.all(tests).then(() => {
    suite.cpu.finish = process.cpuUsage(suite.cpu.start);
    suite.cpu.delta = objectDelta(suite.cpu.start,suite.cpu.finish);
    suite.cpu.pctDelta = objectDeltaPercent(suite.cpu.start,suite.cpu.finish);
    suite.memory.finish = process.memoryUsage();
    suite.memory.delta = objectDelta(suite.memory.start,suite.memory.finish);
    suite.memory.pctDelta = objectDeltaPercent(suite.memory.start,suite.memory.finish);
    console.log("Test Results");
    console.log(JSON.stringify(results,null,2));
    console.log("Suite Results");
    suite.passed = Object.values(suite.results).filter((value) => value==="passed").length;
    suite.failed = Object.values(suite.results).filter((value) => value==="failed").length;
    console.log(JSON.stringify(suite,null,2));
})



