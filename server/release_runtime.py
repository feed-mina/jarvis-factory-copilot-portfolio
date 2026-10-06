"""Registers only server-owned source. Client-supplied paths/code are not accepted."""
import ast,json,subprocess,sys,importlib.metadata,os
from pathlib import Path
from release_dataset import digest

CONTAINER='hermes-a03-gateway-personal-dev-1'
ROOT=Path(__file__).parent
def command(args):
    return subprocess.run(args,text=True,capture_output=True,check=True,timeout=30).stdout.strip()
def environment():
    image=command(['docker','inspect','--format','{{.Image}}',CONTAINER])
    raw=command(['docker','exec',CONTAINER,'python','-c',"import json;from hermes_cli.config import load_config;m=load_config()['model'];print(json.dumps({'default':m['default'],'provider':m['provider']}))"])
    model=json.loads(raw)
    deps=sorted((d.metadata['Name'],d.version) for d in importlib.metadata.distributions())
    return {'container':CONTAINER,'image_digest':image,'model':model,'dependency_hash':digest(deps),'python':sys.version.split()[0],
      'generation':{'max_tokens':2200,'max_iterations':1,'tools':False},'model_revision':'unknown'}
def snapshot():
    pipeline=(ROOT/'pipeline.py').read_text(encoding='utf-8');role=(ROOT/'role_runner.py').read_text(encoding='utf-8')
    old="m=load_config()['model'];r=resolve_runtime_provider(requested=m['provider'],target_model=m['default'])"
    if old not in role:raise RuntimeError('Role runner contract changed')
    role=role.replace(old,"m=envelope['model'];r=resolve_runtime_provider(requested=m['provider'],target_model=m['default'])")
    role=role.replace("'provider':m['provider']}","'provider':m['provider'],'tools_disabled':True}")
    constants={};versions={}
    for node in ast.parse(pipeline).body:
        if isinstance(node,ast.Assign):
            for target in node.targets:
                if isinstance(target,ast.Name) and target.id in ('VERSION','PROMPT_VERSION','PROMPTS'):
                    constants[target.id]=ast.get_source_segment(pipeline,node)
                    if target.id in ('VERSION','PROMPT_VERSION'):versions[target.id]=ast.literal_eval(node.value)
    value={'pipeline':pipeline,'role':role,'child':(ROOT/'release_child.py').read_text(encoding='utf-8'),
      'manifest':{**environment(),'pipeline_version':versions['VERSION'],'prompt_version':versions['PROMPT_VERSION'],'source_hash':digest(pipeline),'prompt_hash':digest(constants),'registered_source':'server-owned snapshot'}}
    return {**value,'digest':digest(value)}
def run_snapshot(snap,source):
    frozen={k:v for k,v in snap.items() if k!='digest'}
    if digest(frozen)!=snap['digest']:raise RuntimeError('Artifact digest mismatch')
    before=environment()
    if any(before[k]!=snap['manifest'][k] for k in before):raise RuntimeError('Runtime drift')
    process=subprocess.run([sys.executable,'-I','-c',snap['child']],input=json.dumps({'snapshot':snap,'source':source}),
      text=True,capture_output=True,timeout=850,env={k:os.environ[k] for k in ('PATH','LANG','SYSTEMROOT') if k in os.environ})
    if process.returncode:raise RuntimeError('Isolated evaluation failed')
    if environment()!=before:raise RuntimeError('Runtime changed during evaluation')
    return json.loads(process.stdout)
