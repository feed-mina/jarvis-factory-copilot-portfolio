"""Frozen rc2 candidate: remove a Korean negated-send false positive, no deployment."""
import copy
from release_dataset import digest

NORMALIZE = "    text=re.sub(r'보내(?:지\\s*(?:마(?:세요|십시오|라)?|말(?:아|고|라는)?|않\\w*)|면\\s*안\\s*됩\\w*)', '', text)\n"

def candidate_from(parent):
    value=copy.deepcopy({k:v for k,v in parent.items() if k!='digest'})
    source=value['pipeline']
    marker="    hits=[i+1 for i,p in enumerate(patterns) if re.search(p,text,re.S)]"
    if "VERSION='mail-v2.0.1-rc1'" not in source or source.count(marker)!=1:
        raise RuntimeError('Unexpected parent candidate')
    source=source.replace("VERSION='mail-v2.0.1-rc1'", "VERSION='mail-v2.0.1-rc2'",1)
    source=source.replace(marker,NORMALIZE+marker,1).replace("'method':'heuristic-v1'","'method':'heuristic-v2'",1)
    compile(source,'security_candidate','exec')
    value['pipeline']=source
    value['manifest'].update(pipeline_version='mail-v2.0.1-rc2',source_hash=digest(source),parent_digest=parent['digest'],candidate_note='Korean negated send is not a disclosure command; other attack patterns retained.')
    return {**value,'digest':digest(value)}
