module.exports={
 appId:'studio.filmma.app',productName:'Filmma',directories:{output:'release'},
 files:['desktop/main.cjs','desktop/preload.cjs','package.json','!node_modules/**/*'],
 extraResources:[{from:'build/desktop-resources',to:'.'},{from:'build/desktop-resources/node_modules',to:'node_modules',filter:['**/*']}],asar:true,
 mac:{icon:'desktop/Filmma.icns',category:'public.app-category.video',target:['dmg','zip'],identity:null,hardenedRuntime:false,minimumSystemVersion:'27.0',artifactName:'Filmma-${version}-${arch}.${ext}'},
 dmg:{title:'Filmma',window:{width:600,height:380},contents:[{x:170,y:170,type:'file'},{x:430,y:170,type:'link',path:'/Applications'}]},
 win:{icon:'desktop/Filmma.ico',target:[{target:'nsis',arch:['x64']},{target:'zip',arch:['x64']}],artifactName:'Filmma-${version}-win-${arch}.${ext}',signAndEditExecutable:false},
 nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,deleteAppDataOnUninstall:false,artifactName:'Filmma-${version}-win-${arch}-Setup.${ext}'},
 afterPack:async context=>{const path=require('node:path'),fs=require('node:fs/promises');const resources=context.electronPlatformName==='darwin'?path.join(context.appOutDir,'Filmma.app/Contents/Resources'):path.join(context.appOutDir,'resources');for(const name of ['express','sharp','zod'])await fs.access(path.join(resources,'node_modules',name,'package.json'));if(context.electronPlatformName!=='darwin')return;const{execFileSync}=require('node:child_process');const app=path.join(context.appOutDir,'Filmma.app');execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'})}
};
