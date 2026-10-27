import {Component} from 'react';
import type {ErrorInfo,ReactNode} from 'react';
export default class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 componentDidCatch(error:Error,info:ErrorInfo){console.error('Filmma interface error',error,info.componentStack)}
 render(){return this.state.failed?<main className="boot"><div className="wordmark">filmma</div><h1>Vamos a abrir el estudio de nuevo.</h1><p>La interfaz encontró un problema. El proyecto guardado y tus archivos siguen en este Mac.</p><button onClick={()=>location.reload()}>Volver a abrir Filmma</button></main>:this.props.children}
}
