import { ISerializable } from '@taleweaver/core/dist/model/serializer';
import { generateId } from '@taleweaver/core/dist/tw/util/id';

const doc: ISerializable = {
    componentId: 'doc',
    id: generateId(),
    attributes: {
        pageWidth: 816,
        pageHeight: 1056,
        pagePaddingTop: 40,
        pagePaddingBottom: 40,
        pagePaddingLeft: 40,
        pagePaddingRight: 40,
    },
    children: [
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            marks: [{ typeId: 'weight', start: 0, end: 344, attributes: { weight: 700 } }],
            content:
                'Once upon a time there lived in a certain village a little country girl, the prettiest creature was ever seen. Her mother was excessively fond of her; and her grandmother doted on her still more. This good woman had made for her a little red riding-hood; which became the girl so extremely well that everybody called her Little Red Riding-Hood.',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            marks: [{ typeId: 'color', start: 0, end: 59, attributes: { color: '#ff0000' } }],
            content: 'One day her mother, having made some custards, said to her:',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            marks: [{ typeId: 'size', start: 0, end: 133, attributes: { size: 20 } }],
            content:
                '"Go, my dear, and see how thy grandmamma does, for I hear she has been very ill; carry her a custard, and this little pot of butter."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            marks: [{ typeId: 'italic', start: 0, end: 98, attributes: { italic: true } }],
            content:
                'Little Red Riding-Hood set out immediately to go to her grandmother, who lived in another village.',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            marks: [
                { typeId: 'strikethrough', start: 0, end: 306, attributes: { strikethrough: true } },
                { typeId: 'underline', start: 0, end: 306, attributes: { underline: true } },
            ],
            content:
                'As she was going through the wood, she met with Gaffer Wolf, who had a very great mind to eat her up, but he dared not, because of some faggot-makers hard by in the forest. He asked her whither she was going. The poor child, who did not know that it was dangerous to stay and hear a wolf talk, said to him:',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            marks: [{ typeId: 'letterSpacing', start: 0, end: 306, attributes: { letterSpacing: 4 } }],
            content:
                '"I am going to see my grandmamma and carry her a custard and a little pot of butter from my mamma."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            marks: [{ typeId: 'family', start: 0, end: 306, attributes: { family: 'cursive' } }],
            content: '"Does she live far off?" said the Wolf.',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content:
                '"Oh! ay," answered Little Red Riding-Hood; "it is beyond that mill you see there, at the first house in the village."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content:
                '"Well," said the Wolf, "and I\'ll go and see her too. I\'ll go this way and you go that, and we shall see who will be there soonest."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content:
                "The Wolf began to run as fast as he could, taking the nearest way, and the little girl went by that farthest about, diverting herself in gathering nuts, running after butterflies, and making nosegays of such little flowers as she met with. The Wolf was not long before he got to the old woman's house. He knocked at the door--tap, tap.",
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content:
                '"Your grandchild, Little Red Riding-Hood," replied the Wolf, counterfeiting her voice; "who has brought you a custard and a little pot of butter sent you by mamma."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: 'The good grandmother, who was in bed, because she was somewhat ill, cried out',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"Pull the bobbin, and the latch will go up."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content:
                "The Wolf pulled the bobbin, and the door opened, and then presently he fell upon the good woman and ate her up in a moment, for it was above three days that he had not touched a bit. He then shut the door and went into the grandmother's bed, expecting Little Red Riding- Hood, who came some time afterward and knocked at the door--tap, tap.",
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"Who\'s there?"',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content:
                'Little Red Riding-Hood, hearing the big voice of the Wolf, was at first afraid; but believing her grandmother had got a cold and was hoarse, answered:',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content:
                '" \'Tis your grandchild, Little Red Riding-Hood, who has brought you a custard and a little pot of butter mamma sends you."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: 'The Wolf cried out to her, softening his voice as much as he could:',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"Pull the bobbin, and the latch will go up."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: 'Little Red Riding-Hood pulled the bobbin, and the door opened.',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: 'The Wolf, seeing her come in, said to her, hiding himself under the bed-clothes:',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"Put the custard and the little pot of butter upon the stool, and come and lie down with me."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content:
                'Little Red Riding-Hood undressed herself and went into bed, where, being greatly amazed to see how her grandmother looked in her night-clothes, she said to her:',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"Grandmamma, what great arms you have got!"',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"That is the better to hug thee, my dear."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"Grandmamma, what great legs you have got!"',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"That is to run the better, my child."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"Grandmamma, what great ears you have got!"',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"That is to hear the better, my child."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"Grandmamma, what great eyes you have got!"',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"It is to see the better, my child."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"Grandmamma, what great teeth you have got!"',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: '"That is to eat thee up."',
        },
        {
            componentId: 'paragraph',
            id: generateId(),
            attributes: {},
            content: 'And, saying these words, this wicked wolf fell upon Little Red Riding-Hood, and ate her all up.',
        },
    ],
};

export default doc;
