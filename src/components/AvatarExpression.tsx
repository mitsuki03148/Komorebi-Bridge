import type { CLIModelId } from '../types/guild';
import { PORTRAIT_URLS } from '../data/initialGuildData';

// The patches follow the eyes of the bust artwork in its original coordinates.
// Keeping the glasses, fringe and portrait itself still avoids a frame jump.
const faces = {
  AGY: {
    skin: 'M365 645 Q460 515 552 645 Q460 760 365 645Z M685 645 Q780 515 875 645 Q780 760 685 645Z',
    lids: 'M385 655 Q460 705 540 650 M698 650 Q780 705 858 655',
    focus: 'M368 640 Q460 515 550 640 L548 660 Q460 605 368 640Z M688 640 Q780 515 872 640 L870 660 Q780 605 688 640Z',
    focusLine: 'M385 640 Q460 602 540 645 M698 645 Q780 602 858 640',
    happyLine: 'M388 658 Q460 578 538 658 M700 658 Q780 578 855 658',
    mouthCover: 'M565 760 Q618 754 670 760 L670 802 Q618 810 565 802Z',
    smile: 'M572 770 Q618 788 664 770 Q650 802 618 802 Q586 802 572 770Z',
    lips: 'M586 780 Q618 775 650 780',
  },
  CODEX: {
    skin: 'M352 719 Q383 659 442 659 Q488 654 521 696 Q528 731 503 761 Q475 788 424 778 Q375 773 352 719Z M657 684 Q688 640 740 637 Q795 632 840 681 Q827 722 799 747 Q741 772 693 751 Q659 727 657 684Z',
    lids: 'M366 720 Q425 756 508 725 M670 696 Q747 735 826 694',
    focus: 'M353 716 Q370 675 418 660 Q479 649 517 690 L522 723 Q435 682 353 716Z M657 686 Q693 639 741 635 Q804 630 842 679 Q753 655 657 710Z',
    focusLine: 'M363 716 Q439 682 515 722 M666 706 Q753 655 832 679',
    happyLine: 'M371 734 Q439 678 506 738 M675 715 Q744 655 824 705',
    mouthCover: 'M565 829 Q603 820 649 835 L647 878 Q602 884 568 873Z',
    smile: 'M566 842 Q606 856 650 839 Q637 879 608 879 Q580 878 566 842Z',
    lips: 'M582 853 Q607 848 633 852',
  },
  CLAUDE: {
    skin: 'M388 672 Q408 615 465 602 Q515 592 546 638 Q558 675 537 703 Q493 728 440 714 Q403 709 388 672Z M682 636 Q700 591 751 586 Q804 581 834 623 Q844 661 819 686 Q773 710 724 695 Q695 686 682 636Z',
    lids: 'M398 670 Q464 705 541 667 M693 645 Q755 681 828 641',
    focus: 'M391 668 Q421 602 476 601 Q527 595 548 638 L550 669 Q479 631 391 668Z M684 637 Q704 591 753 584 Q804 582 836 625 Q757 610 684 658Z',
    focusLine: 'M401 666 Q480 634 543 670 M692 653 Q756 612 829 626',
    happyLine: 'M408 681 Q473 623 539 681 M702 655 Q758 600 822 651',
    mouthCover: 'M568 767 Q625 758 686 760 L690 803 Q634 815 572 805Z',
    smile: 'M572 774 Q627 788 684 768 Q660 813 627 812 Q592 810 572 774Z',
    lips: 'M594 787 Q627 781 658 784',
  },
};

export function AvatarExpression({ modelId, src, working = false, unread = false }: {
  modelId: CLIModelId;
  src: string;
  working?: boolean;
  unread?: boolean;
}) {
  if (src !== PORTRAIT_URLS[modelId]) return null;
  const face = faces[modelId];
  const mood = unread ? 'unread' : working ? 'working' : 'idle';
  const skin = modelId === 'CLAUDE' ? '#F8CEAE' : '#F9D6B9';
  return (
    <svg aria-hidden="true" viewBox="0 0 1254 1254"
      data-cli={modelId} data-expression={mood}
      className={`pointer-events-none absolute inset-0 h-full w-full ${mood === 'idle' ? 'guild-avatar-blink' : ''}`}>
      <path d={mood === 'working' ? face.focus : face.skin} fill={skin} />
      <path d={mood === 'working' ? face.focusLine : mood === 'unread' ? face.happyLine : face.lids}
        fill="none" stroke="#644237" strokeWidth={mood === 'idle' ? 15 : 20} strokeLinecap="round" />
      {mood === 'unread' && <>
        <path d={face.mouthCover} fill={skin} />
        <path d={face.smile} fill="#9C5149" stroke="#73463D" strokeWidth="6" strokeLinejoin="round" />
        <path d={face.lips} fill="none" stroke="#E39A87" strokeWidth="11" strokeLinecap="round" />
      </>}
    </svg>
  );
}
