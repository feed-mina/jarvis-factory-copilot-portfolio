import {useEffect,useState} from "react";

interface InstallPromptEvent extends Event {
  prompt:()=>Promise<void>;
  userChoice:Promise<{outcome:"accepted"|"dismissed"}>;
}

export function PwaInstallButton(){
  const [prompt,setPrompt]=useState<InstallPromptEvent|null>(null);
  useEffect(()=>{
    const ready=(event:Event)=>{event.preventDefault();setPrompt(event as InstallPromptEvent)};
    const installed=()=>setPrompt(null);
    window.addEventListener("beforeinstallprompt",ready);
    window.addEventListener("appinstalled",installed);
    return()=>{window.removeEventListener("beforeinstallprompt",ready);window.removeEventListener("appinstalled",installed)};
  },[]);
  if(!prompt)return null;
  return <button className="pwa-install" type="button" onClick={async()=>{
    await prompt.prompt();
    const choice=await prompt.userChoice;
    if(choice.outcome==="accepted")setPrompt(null);
  }}>앱 설치</button>;
}
