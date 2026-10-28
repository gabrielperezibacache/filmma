module.exports={
 appId:'studio.filmma.app',productName:'Filmma',directories:{output:'release'},
 files:['desktop/main.cjs','desktop/preload.cjs','package.json','!node_modules/**/*'],
 extraResources:[{from:'build/desktop-resources',to:'.'}],asar:true,
 mac:{icon:'desktop/Filmma.icns',category:'public.app-category.video',target:['dmg','zip'],identity:null,hardenedRuntime:false,minimumSystemVersion:'27.0',artifactName:'Filmma-${version}-${arch}.${ext}'},
 dmg:{title:'Filmma',window:{width:600,height:380},contents:[{x:170,y:170,type:'file'},{x:430,y:170,type:'link',path:'/Applications'}]},
 win:{icon:'desktop/Filmma.ico',target:[{target:'nsis',arch:['x64']},{target:'zip',arch:['x64']}],artifactName:'Filmma-${version}-win-${arch}.${ext}',signAndEditExecutable:false},
 nsis:{oneClick:false,perMachine:false,allowElevation:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,deleteAppDataOnUninstall:false,artifactName:'Filmma-${version}-win-${arch}-Setup.${ext}'},
 afterPack:async context=>{if(context.electronPlatformName!=='darwin')return;const{execFileSync}=require('node:child_process');const app=require('node:path').join(context.appOutDir,'Filmma.app');execFileSync('codesign',['--force','--deep','--sign','-',app],{stdio:'inherit'})}
};
