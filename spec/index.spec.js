import { performance } from "node:perf_hooks";
import os from "node:os"
import process from "node:process";
import vm from "node:vm"
import v8 from "v8";

v8.setFlagsFromString('--expose_gc');
const gc = vm.runInNewContext('gc');

import { max, min, mean, std, sum, variance } from 'mathjs/number'

import ipvfs from "../index.js";
import {create} from "ipfs";
import {all} from "@anywhichway/all";

const objectDelta = (start,finish) => {
    return Object.entries(start).reduce((delta,[key,value]) => {
        if(typeof(value)==="number" && typeof(finish[key])==="number") {
            delta[key] = finish[key] - value;
        }
        return delta;
    },{})
}

const OldPromise = global.Promise;
global.Promise = class Promise extends OldPromise {
    constructor(executor) {
        super(executor); // call native Promise constructor
        Promise.instances.add(this);
    }
}
global.Promise.instances = new Set();

const objectDeltaPercent = (start,finish) => {
    return Object.entries(start).reduce((delta,[key,value]) => {
        if(typeof(value)==="number" && typeof(finish[key])==="number") {
            delta[key] = ((finish[key] / value) - 1) + "%";
        }
        return delta;
    },{})
}

const issues = (summary) => {
    const issues = {};
    Object.entries(summary).forEach(([testName,summary]) => {
        if(summary.memory?.delta.heapUsed>0) {
            issues[testName] ||= {};
            issues[testName].heapUsed = summary.memory?.delta.heapUsed
        }
        if(summary.unresolvedPromises>0) {
            issues[testName] ||= {};
            issues[testName].unresolvedPromises = summary.unresolvedPromises;
        }
        Object.entries(summary.activeResources).forEach(([resourceType,count]) => {
            issues[testName] ||= {};
            issues[testName][resourceType] = count;
        })
    })
    return issues;
}

const summarize = (metrics) => {
    const summary = {};
    Object.entries(metrics).filter(([key]) => !["performance","cpu","memory","unresolvedPromises","activeResources"].includes(key)).forEach(([testName, {memory,unresolvedPromises,activeResources,samples}]) => {
        const testSummary = {cycles:samples.length,memory:{},unresolvedPromises,activeResources},
            durations = [],
            cputime = {};
        samples.forEach((sample) => {
            if(metrics.performance) {
                durations.push(sample.performance);
            }
            if(metrics.cpu) {
                Object.entries(sample.cpu).forEach(([cpuType,value]) => {
                    if(cpuType==="delta") {
                        return;
                    }
                    cputime[cpuType] ||= [];
                    cputime[cpuType].push(value);
                })
            }
        })

        if(metrics.performance) {
            const performance = testSummary.performance = {};
            Object.defineProperty(performance,"count",{enumerable:true,get() { return durations.length }});
            Object.defineProperty(performance,"sum",{enumerable:true,get() { return sum(durations)}});
            Object.defineProperty(performance,"max",{enumerable:true,get() { return durations.length>0 ? max(durations) : undefined }});
            Object.defineProperty(performance,"avg",{enumerable:true,get() { return durations.length>0 ? mean(durations) : undefined }});
            Object.defineProperty(performance,"min",{enumerable:true,get() { return durations.length>0 ? min(durations) : undefined }});
            Object.defineProperty(performance,"var",{enumerable:true,get() { return durations.length>0 ? variance(durations) : undefined }});
            Object.defineProperty(performance,"stdev",{enumerable:true,get() { return durations.length>0 ? std(durations) : undefined }});
        }

        if(metrics.cpu) {
            const cpu = testSummary.cpu = {};
            Object.entries(cputime).forEach(([cpuType,values]) => {
                const o = cpu[cpuType] = {};
                Object.defineProperty(o,"count",{enumerable:true,get() { return values.length }});
                Object.defineProperty(o,"sum",{enumerable:true,get() { return sum(values)}});
                Object.defineProperty(o,"max",{enumerable:true,get() { return values.length>0 ? max(values) : undefined }});
                Object.defineProperty(o,"avg",{enumerable:true,get() { return values.length>0 ? mean(values) : undefined }});
                Object.defineProperty(o,"min",{enumerable:true,get() { return values.length>0 ? min(values) : undefined }});
                Object.defineProperty(o,"var",{enumerable:true,get() { return values.length>0 ? variance(values) : undefined }});
                Object.defineProperty(o,"stdev",{enumerable:true,get() { return values.length>0 ? std(values) : undefined }});
            })
        }

        if(metrics.memory && memory.start && memory.finish) {
            testSummary.memory.delta = objectDelta(memory.start,memory.finish);
            testSummary.memory.deltaPercent = objectDeltaPercent(memory.start,memory.finish);
        }

        summary[testName] = testSummary;
    })
    return summary;
}

const _it = it,
    computeMetrics = (sample,metrics) => {
        if(sample.performance) {
            sample.performance = performance.now() - sample.performance;
        }
        if(sample.cpu) {
            sample.cpu = process.cpuUsage(sample.cpu);
        }
        metrics.push(sample);
    }
it = function(name,f,options) {
    let timeout, cycles = 1, metrics;
    if(typeof(options)==="number" || !options) {
        timeout = options;
    } else {
        timeout = options.timeout;
        cycles = options.cycles || cycles;
        metrics = options.metrics;
    }
    const _f = f,
        sampleMetrics = [],
        memory = metrics?.memory ? {} : undefined,
        AsyncFunction = (async ()=>{}).constructor;
    let unresolvedPromises,
        active,
        activeResources;
   if(f.constructor===AsyncFunction) {
        f = async function(...args)  {
            unresolvedPromises = Promise.instances?.size||0;
            active = process.getActiveResourcesInfo().reduce((resources,item) => {
                resources[item] ||= 0;
                resources[item]++;
                return resources;
            },{});
            Promise.instances?.clear();
            try {
                await _f(...args);
            } catch(e) {
                throw e;
            }
            unresolvedPromises = Promise.instances?.size||0 > unresolvedPromises ? Promise.instances?.size||0 - unresolvedPromises:  0;
            activeResources = process.getActiveResourcesInfo().reduce((resources,item) => {
                resources[item] ||= 0;
                resources[item]++;
                return resources;
            }, {});
            Object.entries(activeResources).forEach(([key,value]) => {
                if(value<=active[key]) {
                    delete activeResources[key];
                } else {
                    activeResources[key] = activeResources[key] - (active[key] || 0)
                }
            })
            if(metrics) {
                gc();
                if(memory) {
                    memory.start = process.memoryUsage();
                }
                let cycle = 1,error;
                while(cycle<=cycles) {
                    const sample = {
                        cycle,
                        cpu: metrics.cpu ? process.cpuUsage() : undefined,
                        performance: metrics.performance ? performance.now() : undefined
                    }
                    try {
                        await _f(...args);
                    } catch(e) {
                        error = e;
                    } finally {
                        gc();
                        computeMetrics(sample,sampleMetrics);
                        if(error) {
                            break;
                        }
                        cycle++;
                    }
                }
                if(memory) {
                    memory.finish = process.memoryUsage();
                    memory.delta = objectDelta(memory.start,memory.finish);
                    memory.deltaPct = objectDeltaPercent(memory.start,memory.finish);
                }
                metrics[spec.getFullName()] = {
                    memory,
                    unresolvedPromises,
                    activeResources,
                    samples:sampleMetrics
                }
                if(error) {
                    throw error;
                }
            }
        }
   } else {
        f = function(...args)  {
            unresolvedPromises = Promise.instances?.size||0;
            active = process.getActiveResourcesInfo().reduce((resources,item) => {
                resources[item] ||= 0;
                resources[item]++;
                return resources;
            },{});
            Promise.instances?.clear();
            try {
                _f(...args);
            } catch(e) {
                throw e;
            }
            unresolvedPromises = Promise.instances?.size||0 > unresolvedPromises ? Promise.instances?.size||0 - unresolvedPromises: 0;
            activeResources = process.getActiveResourcesInfo().reduce((resources,item) => {
                resources[item] ||= 0;
                resources[item]++;
                return resources;
            }, {});
            Object.entries(activeResources).forEach(([key,value]) => {
                if(value<=active[key]) {
                    delete activeResources[key];
                } else {
                    activeResources[key] = activeResources[key] - (active[key] || 0)
                }
            })
            if(metrics) {
                gc();
                if(memory) {
                    memory.start = process.memoryUsage();
                }
                let cycle = 1,error;
                while(cycle<=cycles) {
                    const sample = {
                        cycle,
                        cpu: metrics.cpu ? process.cpuUsage() : undefined,
                        performance: metrics.performance ? performance.now() : undefined
                    }
                    try {
                        _f(...args);
                    } catch(e) {
                        error = e;
                    } finally {
                        gc();
                        computeMetrics(sample,sampleMetrics);
                        if(error) {
                            break;
                        }
                        cycle++;
                    }
                }
                if(memory) {
                    memory.finish = process.memoryUsage();
                    memory.delta = memory.end - memory.start
                }
                metrics[spec.getFullName()] = {
                    memory,
                    unresolvedPromises,
                    activeResources,
                    samples:sampleMetrics
                }
                if(error) {
                    throw error;
                }
            }
        }
    }
    const spec = _it(name,f,timeout);
    return spec;
}
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

    const metrics = {memory:true, cpu:true, performance:true, unresolvedPromises: true,activeResources:true},
        cycles = 100;
    it("Promise test 1",() => {
        const promise = new Promise((resolve,reject) => {});
        expect(promise).toBeInstanceOf(Promise)
    },{metrics})
    it("Promise test 2",() => {
        const promise = (async () => 0)();
        expect(promise.constructor.name).toBe("Promise");
    },{metrics})
    it("memtest1",() => {
        const text = "".padStart(1024,"a");
    }, {metrics,cycles})
    it("memtest2",() => {
       garbage.push("".padStart(1024,"a"));
    },{metrics,cycles})
    it("ipfs write/read file",async () => {
        const fname = randomFileName();
        await ipfs.files.write("/"+fname,"test",{create:true});
        let result = "";
        for await(const chunk of await ipfs.files.read("/"+fname)) {
            result += chunk.toString();
        }
        expect(result).toBe("test");
    },{metrics,cycles:10})
    it("write/read file",async () => {
        const fname = randomFileName();
        await ipfs.files.versioned.write("/"+fname,"test");
        const result = await ipfs.files.versioned.read("/"+fname,{all:true});
        expect(result).toBe("test");
    },{metrics,cycles:10})
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
        const cid = await ipfs.files.versioned.publish("/"+fname+"#1",mfname),
            result = await ipfs.files.versioned.read("/"+fname,{all:true});
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
        console.log(JSON.stringify(issues(summarize(metrics)),null,2));
    })
})






