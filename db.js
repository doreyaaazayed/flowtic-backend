mongoose.connect("mongodb+srv://graduationp395_db_user:PXOQmdBqY5w4Q2gu@flowticdb.gjukzav.mongodb.net/")
.then(()=>console.log("connection is Successfully"))
.catch((err)=>console.log(`error is  : ${err}`))