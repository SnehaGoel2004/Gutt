#!/usr/bin/env node    
//It is called shebang(where #! is a shebang indicator that tells the OS that itis a script)
 // /usr/bin/env is a system command that finds the correct node executable
// node specifies that the script should be run using Node.js
// used when u want the script to be run directly from the terminal
const path= require("path");
const fs= require("fs").promises;
const crypto =require("crypto");  //module in Node.js
const {diffLines}=require("diff");
const chalk=require("chalk");
const { Command } = require('commander'); //to create command line interface.
const program = new Command();

class Gutt{
    constructor(repoPath= __dirname) {     //"." represents the current folder
    
        this.repoPath=path.join(repoPath,".gutt");  
         //we want to create a .gutt folder just like .git folder whenever theuser uses gutt init
         // we are creating ".gutt" folder inside the "." current folder
         // repoPath is storing the path to the ".gutt" foder
         this.objectPath=path.join(this.repoPath,"objects");  //  .gutt/objects  
         this.headPath=path.join(this.repoPath,"HEAD");   //  .gutt/HEAD   HEAD ia a file
         this.indexPath=path.join(this.repoPath,"index");  //  .gutt/index   
         // index file will contain details if the staging area
         this.init();

    }  



    async init(){
        await fs.mkdir(this.objectPath,{recursive:true});   //Creates a directory at this.objectPath.
        //The { recursive: true } option ensures that if parent directories don’t exist, they are created.
        try{
           await fs.writeFile(this.headPath,"",{flag:"wx"});  //Attempts to create a new file at this.headPath and write a single space (" ") to it.
          // The { flag: "wx" } option:
           // w → opens file for writing
          //  x → Fails if the file already exists.

          await fs.writeFile(this.indexPath,JSON.stringify([]),{flag:"wx"});    //Writes an empty JSON array ([]) to the file at this.index.
          // JSON.stringify([]) converts an empty array into a JSON string: "[]".
          // { flag: "wx" } ensures that the file is only created if it does not already exis

        } catch(error){
            if (error.code === "EEXIST") {
                console.log("Already initialized .gutt folder");
            } else {
                console.error("Error initializing .gutt:", error);
            }

        }

    }


    hashObject(content){
       return crypto.createHash("sha1").update(content,"utf-8").digest("hex");
        //create the object that will use crypto functions and methods
        //create the hash of the content given

    }

    async add(fileToBeAdded){
        try{  //reads the content of the file to be added, produces the hash of its content , makes blob object of its content.  
        const fileData=await fs.readFile(fileToBeAdded,{encoding:"utf-8"});
        const fileHash=this.hashObject(fileData);
        console.log(fileHash);
        const newFileHashedPath=path.join(this.objectPath,fileHash.substring(0,2)); //.gutt/object/1st 2 chars of hash/remaining hash/fileData or content
        const hashFile=path.join(newFileHashedPath,fileHash.substring(2));

        await fs.mkdir(newFileHashedPath, { recursive: true });

        await fs.writeFile(hashFile,fileData);  //.gutt/object/1st 2 chars of hash/remaining hash/fileData or content
        await this.updateStagingArea(fileToBeAdded,fileHash);
        console.log(`Added ${fileToBeAdded}`); //adding file to the staging area
        } catch(error){
            console.error(`error in add():`,error);
        }

    }

    async updateStagingArea(filePath,fileHash){
        const index=JSON.parse(await fs.readFile(this.indexPath,{encoding:"utf-8"}));
        // Reads the contents of the file located at this.index (which is .gutt/index).
        // The utf-8 encoding ensures the file is read as a text string instead of raw bytes.
        //Parses the string from the file into a JavaScript object or array.
        index.push({path:filePath,hash:fileHash});  //add file to the indexFile.
        await fs.writeFile(this.indexPath,JSON.stringify(index,null,2)); // update the indexFile file.
        console.log(`"${filePath}" added to staging.`);
    }

    async commit(message){
        console.log("commit() function called...");
        const index = JSON.parse(await fs.readFile(this.indexPath, { encoding: "utf-8" }));
        if (index.length === 0) {
            console.log("No files to commit.");
            return;
        }
        const parentCommit = await this.getCurrentHead();
        const commitData = {
            timeStamp: new Date().toISOString(),
            message,
            files: index,
            parent: parentCommit
        };

        const commitHash = this.hashObject(JSON.stringify(commitData));
        const commitPath = path.join(this.objectPath, commitHash);

        try {
            await fs.writeFile(commitPath, JSON.stringify(commitData));
            await fs.writeFile(this.headPath, commitHash);
            await fs.writeFile(this.indexPath, JSON.stringify([]));
            console.log(`Commit successfully created: ${commitHash}`);
        } catch (error) {
            console.error("❌ Error while committing:", error);
        }
    }


    async getCurrentHead() {
        try {
            const headContent = await fs.readFile(this.headPath, { encoding: "utf-8" });
            return headContent.trim() || null;
        } catch (error) {
            return null;
        }
    }


    async log(){
        let currentCommitHash=await this.getCurrentHead();;
        while(currentCommitHash){
            const commitData=JSON.parse(await fs.readFile(path.join(this.objectPath,currentCommitHash),{encoding:"utf-8"}));
            console.log(`--------------------------\n`);
            console.log(`commit:${currentCommitHash}\nDate:${commitData.timeStamp}\n\n${commitData.message}\n\n`);

            currentCommitHash=commitData.parent;
        }
    }


    async showCommitDiff(commitHash){
        console.log(`looking for commit:${commitHash}`);
        const commitData= await this.getCommitData(commitHash);
        if(!commitData){
            console.log("commit not found");
            return;
        }
        console.log("commit found",commitData);

        for(const file of commitData.files){
            console.log(`File:${file.path}`);
            const fileContent=await this.getFileContent(file.hash);
            console.log(fileContent);


            if(commitData.parent){
                console.log("checking parent commit.....");
                //get the parent commit data
                const parentCommitData=await this.getCommitData(commitData.parent); //throw the content of parent commit.
                const parentFileContent=await this.getParentFileContent(parentCommitData,file.path);

                if(parentFileContent!==undefined){
                    console.log(`\nDiff for ${file.path}:`);
                    const diff=diffLines(parentFileContent,fileContent);
                      console.log(diff);

                    diff.forEach(part=>{
                        if(part.added){  //if a line has been added, mark it with green color.
                            process.stdout.write(chalk.green(part.value));

                        } else if(part.removed){  //if line being removed, mark it with red.
                            process.stdout.write(chalk.red(part.value));

                        } else{ //if no change has taken place,mark it with grey.
                            process.stdout.write(chalk.white(part.value));

                        }
                    });

                    console.log();
                } else{
                    console.log("New file in the commit");
                }
            } else{
                console.log("First commit,no parent to compare");
            }
        }
    }

    async getParentFileContent(parentCommitData,filePath){
        /*check if the same file is present in the parent commit or not? (file.path==filePath) if present ,
        it means somechange has taken place to the file.*/
        const parentFile=parentCommitData.files.find(file => file.path==filePath);

        if(parentFile){
            // get the content from the parent commit and read the content
            return await this.getFileContent(parentFile.hash);
        }
    }


    async getCommitData(commitHash){   //this function will take the hash and goto objects folder to display the content of the particular hashed file.
        const commitPath=path.join(this.objectPath,commitHash);
        try{
            const data= await fs.readFile(commitPath,{encoding:"utf-8"});
            return JSON.parse(data);

        } catch(error){
            console.log("failed to read the commit data");
            return null;

        }

    }


    async getFileContent(fileHash){
        const dir = fileHash.substring(0, 2); // First 2 characters
        const filename = fileHash.substring(2); // Rest of hash
        const filePath=path.join(this.objectPath,dir,filename);
        try{
          const content=await fs.readFile(filePath);
          return content.toString("utf-8");
          
        } catch(error){
            console.error(`error reading this file:${filePath}`,error);
            return null;
        }
    }
}


/*(async()=>{
    const gutt=new Gutt();   /// to check if .gutt folder is creted or not:  npm run init
    console.log("Gutt instanced successfully");
    await gutt.add("sample.txt"); //adds file to the staging area
    await gutt.add("sample2.txt");
    console.log("file added to staging");

    console.log("calling commit() funtion");
    await gutt.commit("Fourth commit");
    console.log("commit function completed");
    await gutt.log(); 

    await gutt.showCommitDiff(`6f859def326d2d39e422dc7e25eec49044740919`);
})();  */

module.exports=Gutt;


program.command('init').action(async()=>{
    const gutt=new Gutt();

});

program.command('add <file>').action(async(file)=>{
    const gutt=new Gutt();
    await gutt.add(file);
});

program.command('commit <message>').action(async(message)=>{
    const gutt=new Gutt();
    await gutt.commit(message);
});


program.command('log').action(async()=>{
    const gutt=new Gutt();
    await gutt.log();
});

program.command('show <commitHash>').action(async(commitHash)=>{
    const gutt=new Gutt();
    await gutt.showCommitDiff(commitHash);
});

//console.log(process.argv);
program.parse(process.argv);