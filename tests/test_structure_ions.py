"""Test the production PDB parser without optional MDAnalysis/Flask dependencies."""
import ast
from pathlib import Path
import unittest
from types import SimpleNamespace
import numpy as np

source = Path(__file__).resolve().parents[1] / 'engine.py'
tree = ast.parse(source.read_text())
names = {'STANDARD', 'ION_NAMES'}
items = [node for node in tree.body if (isinstance(node, ast.FunctionDef) and node.name in {'pdb_residue_key', 'parse_structure'}) or (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets))]
namespace = {'np': np}
exec(compile(ast.Module(body=items, type_ignores=[]), str(source), 'exec'), namespace)
parse = namespace['parse_structure']

def record(kind, serial, atom, name, resid, xyz, segid='PROA', alt=' '):
    return f'{kind:<6}{serial:5d} {atom:^4}{alt}{name:>3} A{resid:4d}    ' + ''.join(f'{x:8.3f}' for x in xyz) + f'  1.00 20.00      {segid:<4}{atom[:2]:>2}'

class IonParsing(unittest.TestCase):
    def setUp(self):
        self.protein = '\n'.join(record('ATOM', i, 'CA', 'ALA', i, [i*2., 0., 0.]) for i in range(1,5))
    def test_protein_nodes_detector_and_ion_identity(self):
        pdb = self.protein + '\n' + record('HETATM', 5, 'ZN', 'ZN', 99, [4., 1., 0.], 'METL') + '\n' + record('HETATM', 6, 'O', 'HOH', 100, [1., 1., 1.])
        structure, detector = parse(pdb, 'test.pdb')
        self.assertEqual(len(structure['residues']),4)
        self.assertEqual([r['id'] for r in structure['residues']],[1,2,3,4])
        self.assertEqual(len(structure['ions']),1)
        self.assertEqual(structure['ions'][0]['segid'],'METL')
        self.assertIn('HETATM',structure['pdb'])
        self.assertNotIn('HOH',structure['pdb'])
        self.assertNotIn('HETATM',detector)
        self.assertNotIn(' ZN ',detector)
    def test_first_model_and_alternate_ion(self):
        ion=record('HETATM',5,'CA','CAL',99,[0.,0.,0.])
        pdb=self.protein+'\n'+ion+'\n'+ion+'\nENDMDL\n'+record('HETATM',6,'ZN','ZN',100,[1.,1.,1.])
        structure,_=parse(pdb,'test');self.assertEqual(len(structure['ions']),1)
        self.assertEqual(structure['ions'][0]['name'],'CAL')
    def test_frame_reconstruction_omits_reference_ions_even_with_colliding_ids(self):
        conf_source = source.with_name('conformations.py')
        function = next(n for n in ast.parse(conf_source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'aligned_frame_pdb')
        scope = dict(namespace)
        scope['node_positions'] = lambda residues, ids, caption: np.arange(len(residues))
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(conf_source), 'exec'), scope)
        xyz = np.array([[0.,0.,0.],[2.,0.,0.],[0.,2.,0.],[0.,0.,2.]])
        pdb = '\n'.join(record('ATOM',i+1,'CA','ALA',i+1,point) for i,point in enumerate(xyz))
        # Deliberately reuse a protein identity and CA atom name for calcium.
        pdb += '\n' + record('HETATM',5,'CA','CAL',1,[100.,100.,100.])
        structure,_ = parse(pdb,'test')
        current = xyz + [3.,4.,5.]
        class Atoms(list):
            positions = current
        atoms = Atoms(SimpleNamespace(residue=SimpleNamespace(atoms=SimpleNamespace(positions=current[i:i+1], names=['CA']))) for i in range(4))
        frame = scope['aligned_frame_pdb'](structure, atoms, structure['residues'])
        self.assertNotIn('HETATM',frame)
        self.assertEqual(sum(line.startswith('ATOM') for line in frame.splitlines()),4)
        observed = np.array([[float(line[i:i+8]) for i in (30,38,46)] for line in frame.splitlines() if line.startswith('ATOM')])
        np.testing.assert_allclose(observed,xyz,atol=.001)
    def test_no_ions_is_unchanged(self):
        structure,detector=parse(self.protein,'test');self.assertEqual(structure['ions'],[])
        self.assertEqual(structure['pdb'],detector)

if __name__ == '__main__': unittest.main()
